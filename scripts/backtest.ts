// 回测：用职业赛历史对局检验推荐排序。
//
// 衡量的是“职业队实际选的英雄排在推荐列表的第几位”——目标是模仿职业选择，不代表选得最好，
// 也不能说明在路人局的效果。它的用处是：①确认引擎没有明显跑偏；②比较各分项是否带来增益。
//
// 防止数据泄漏：
//   - 按赛事切分训练与测试。统计数据（热度、分路、同队共现、选人响应）按周滚动重建：
//     每一周的对局只使用这一周开始之前的数据，和线上“总是用最新数据”的情形一致。
//   - 候选集剔除本局已禁已选的英雄，以及本系列赛中本队已用过的英雄（全局BP）。
//   - BO7第7局（盲选）不参与。
//   - 官方公告的增强/削弱不参与（数据包只有最近的公告，对历史对局不成立）。
// 仍存在的偏差：官方关系和机制标签用的是当前版本的技能原文，历史版本的技能可能不同。
//
// 两种评估口径：
//   - 全部候选：职业队实际选的英雄排在全部可选英雄里的第几位（Top5/Top10）。
//   - 指定位置：只在能打“选手实际所打位置”的英雄里排（Top1/Top3/Top5），对应用户设定“我打某路”的用法。
// 两种切分：2025训练→2026测试；以及最近一届赛事留出（用它之前的全部对局训练）。
//
// 用法：tsx scripts/backtest.ts [--no-write] [--no-rules] [--step-days=7]
import { resolve } from 'node:path';
import { ROOT, readJson, writeJson } from './lib/http.ts';
import { POS_TO_LANE, isBlindDecider, loadBattles, type Battle } from './lib/kpl.ts';
import { computeKpl, dayOffset, HEAT_DAYS } from './lib/kpl-stats.ts';
import { assemble, loadInputs } from './lib/assemble.ts';
import { makeEngine } from '../src/lib/data.ts';
import { newDraft, place, type DraftState, type Side } from '../src/engine/draft.ts';
import { DEFAULT_WEIGHTS, recommendPicks, type Engine, type PartKey } from '../src/engine/recommend.ts';
import type { BacktestMethod, BacktestReport, PickModel } from '../src/types.ts';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const NO_RULES = process.argv.includes('--no-rules');
const NO_WRITE = process.argv.includes('--no-write') || NO_RULES;
const STEP_DAYS = Number(arg('step-days') ?? 7);
const MIN_TRAIN = 2000;

const FEATS: PartKey[] = ['counter', 'synergy', 'needs', 'lane', 'meta', 'exposure', 'proVs', 'proAlly', 'lanePick', 'lanePickRecent', 'banPri'];
/** 手工权重使用的分项 */
const OLD: PartKey[] = ['counter', 'synergy', 'needs', 'lane', 'meta', 'exposure'];
/** 上一版模型使用的分项（对照用） */
const PREV: PartKey[] = [...OLD, 'proVs', 'proAlly', 'lanePick'];
const K = FEATS.length;
const PHASES: { name: string; fromOrder: number; toOrder: number }[] = [
  { name: '第1–2手', fromOrder: 1, toOrder: 2 },
  { name: '第3–6手', fromOrder: 3, toOrder: 6 },
  { name: '第7–10手', fromOrder: 7, toOrder: 10 },
];
const phaseOf = (order: number) => PHASES.findIndex((p) => order >= p.fromOrder && order <= p.toOrder);
/** 系数下限（系数已按“单组模型里分路匹配的系数=1”缩放，所以 1 表示保持手工权重的力度）。
 *  克制：训练目标是模仿职业队选人，学到的克制系数很小；网站的用途是按对方阵容给建议，所以不低于手工权重。
 *  分路：开局前两手队友还没选人，分路分项对所有英雄都一样，学到的系数是0；但用户指定“我打某路”时必须生效。 */
const FLOORS: Record<string, number> = { counter: 1, lane: 1 };

/** 一组候选：分项矩阵 + 实际所选的下标 */
interface View {
  n: number;
  x: Float32Array;
  actual: number;
  order: number;
}

interface Decision extends View {
  league: string;
  date: string;
  /** 每个候选在赛前窗口内的出场次数 */
  pop: Float32Array;
  /** 分路是否有位置（1/0） */
  laneOk: Uint8Array;
  /** 指定位置（职业选手实际所打位置）后的候选；选手位置未知时为 null */
  given: (View & { pop: Float32Array }) | null;
}

function collect(battles: Battle[], engine: Engine, pop: Map<number, number>, league: string, used: Map<string, Set<number>>): Decision[] {
  const out: Decision[] = [];
  const noPatch = { ...DEFAULT_WEIGHTS, patch: 0 };
  const rows = (recs: ReturnType<typeof recommendPicks>) => {
    const x = new Float32Array(recs.length * K);
    recs.forEach((r, i) => FEATS.forEach((k, j) => (x[i * K + j] = r.parts.find((q) => q.key === k)?.value ?? 0)));
    return x;
  };
  for (const b of battles) {
    if (isBlindDecider(b)) continue;
    let d: DraftState = newDraft('free', 5);
    const banIdx = { blue: 0, red: 0 };
    const pickIdx = { blue: 0, red: 0 };
    let order = 0;
    for (const step of b.bp) {
      const side: Side = step.camp === 1 ? 'blue' : 'red';
      if (!(step.hero > 0)) continue;
      if (!step.pick) {
        if (banIdx[side] < 5) d = place(d, { side, kind: 'ban', index: banIdx[side]++ }, step.hero);
        continue;
      }
      order++;
      const team = step.camp === 1 ? b.camp1_team : b.camp2_team;
      const key = `${b.match_id}|${team}`;
      const usedSet = used.get(key) ?? new Set<number>();
      used.set(key, usedSet);

      if (engine.byId.has(step.hero) && pickIdx[side] < 5) {
        const ok = (r: { hero: { id: number; isLimited: boolean } }) => !usedSet.has(r.hero.id) && !r.hero.isLimited;
        const recs = recommendPicks(engine, d, { side, weights: noPatch, mult: {} }).filter(ok);
        const p = new Float32Array(recs.length);
        const laneOk = new Uint8Array(recs.length);
        recs.forEach((r, i) => {
          p[i] = pop.get(r.hero.id) ?? 0;
          laneOk[i] = (r.parts.find((q) => q.key === 'lane')?.value ?? 0) > DEFAULT_WEIGHTS.laneMiss ? 1 : 0;
        });
        // 指定位置：选手实际打的位置
        const lane = POS_TO_LANE[b.players.find((q) => q.camp === step.camp && q.hero === step.hero)?.pos_desc ?? ''];
        let given: Decision['given'] = null;
        if (lane) {
          const recsL = recommendPicks(engine, d, { side, weights: noPatch, mult: {}, wantLane: lane }).filter((r) => ok(r) && (r.parts.find((q) => q.key === 'lane')?.value ?? 0) > DEFAULT_WEIGHTS.laneMiss);
          const pl = new Float32Array(recsL.length);
          recsL.forEach((r, i) => (pl[i] = r.hero.kpl?.lanesYear?.[lane - 1] ?? 0));
          given = { n: recsL.length, x: rows(recsL), actual: recsL.findIndex((r) => r.hero.id === step.hero), order, pop: pl };
        }
        out.push({ league, date: b.start_time.slice(0, 10), order, n: recs.length, x: rows(recs), pop: p, laneOk, actual: recs.findIndex((r) => r.hero.id === step.hero), given });
      }
      if (pickIdx[side] < 5) d = place(d, { side, kind: 'pick', index: pickIdx[side]++ }, step.hero);
      usedSet.add(step.hero);
    }
  }
  return out;
}

type Scorer<V extends View = View> = (dec: V, i: number) => number;

/** 实际所选英雄的名次（1起）；并列时取中间名次，避免并列被算成第一 */
function rankOf<V extends View>(dec: V, score: Scorer<V>): number {
  if (dec.actual < 0) return Infinity;
  const s = score(dec, dec.actual);
  let better = 0;
  let equal = 0;
  for (let i = 0; i < dec.n; i++) {
    if (i === dec.actual) continue;
    const v = score(dec, i);
    if (v > s) better++;
    else if (v === s) equal++;
  }
  return better + 1 + equal / 2;
}

function evaluate<V extends View>(decs: V[], id: string, name: string, score: Scorer<V>): BacktestMethod {
  let t1 = 0;
  let t3 = 0;
  let t5 = 0;
  let t10 = 0;
  let rr = 0;
  for (const d of decs) {
    const r = rankOf(d, score);
    if (r <= 1) t1++;
    if (r <= 3) t3++;
    if (r <= 5) t5++;
    if (r <= 10) t10++;
    rr += 1 / r;
  }
  const n = Math.max(1, decs.length);
  const f = (x: number) => +(x / n).toFixed(4);
  return { id, name, top1: f(t1), top3: f(t3), top5: f(t5), top10: f(t10), mrr: f(rr) };
}

const J = (k: PartKey) => FEATS.indexOf(k);
const sumOf = (keys: PartKey[]): Scorer => {
  const idx = keys.map(J);
  return (d, i) => idx.reduce((s, j) => s + d.x[i * K + j], 0);
};
const dot = (th: number[]): Scorer => (d, i) => {
  let s = 0;
  for (let j = 0; j < K; j++) s += th[j] * d.x[i * K + j];
  return s;
};
const byPhase = (ths: number[][]): Scorer => (d, i) => dot(ths[phaseOf(d.order)])(d, i);

/** 条件 logit：P(选 i) ∝ exp(θ·x_i)。Adam 梯度上升，很小的 L2 正则，系数限制为非负
 *  （每个分项的方向在引擎里已经定好：加分为正、减分为负，不允许模型把方向反过来）。 */
function fit(decs: View[], keys: PartKey[] = FEATS, iters = 300): number[] {
  const on = FEATS.map((k) => keys.includes(k));
  const theta: number[] = FEATS.map((_, k) => (on[k] ? 0.1 : 0));
  const m = new Array(K).fill(0);
  const v = new Array(K).fill(0);
  const usable = decs.filter((d) => d.actual >= 0 && d.n > 1);
  if (!usable.length) return theta.map(() => 0);
  for (let it = 1; it <= iters; it++) {
    const g = new Array(K).fill(0);
    for (const d of usable) {
      const n = d.n;
      let max = -Infinity;
      const z = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let k = 0; k < K; k++) s += theta[k] * d.x[i * K + k];
        z[i] = s;
        if (s > max) max = s;
      }
      let sum = 0;
      for (let i = 0; i < n; i++) sum += z[i] = Math.exp(z[i] - max);
      for (let k = 0; k < K; k++) {
        if (!on[k]) continue;
        let ex = 0;
        for (let i = 0; i < n; i++) ex += (z[i] / sum) * d.x[i * K + k];
        g[k] += d.x[d.actual * K + k] - ex;
      }
    }
    for (let k = 0; k < K; k++) {
      if (!on[k]) continue;
      const grad = g[k] / usable.length - 1e-4 * theta[k];
      m[k] = 0.9 * m[k] + 0.1 * grad;
      v[k] = 0.999 * v[k] + 0.001 * grad * grad;
      theta[k] = Math.max(0, theta[k] + (0.02 * (m[k] / (1 - 0.9 ** it))) / (Math.sqrt(v[k] / (1 - 0.999 ** it)) + 1e-8));
    }
  }
  return theta.map((t) => +t.toFixed(4));
}
const fitPhases = (decs: View[], keys: PartKey[] = FEATS) => PHASES.map((_, pi) => fit(decs.filter((d) => phaseOf(d.order) === pi), keys));
/** 统一缩放（除以单组模型里“分路匹配”的系数），并应用下限 */
const normalize = (th: number[], scale: number, floors: Record<string, number>) => FEATS.map((k, j) => +Math.max(th[j] / scale, floors[k] ?? 0).toFixed(3));
const givenOf = (decs: Decision[]) => decs.map((d) => d.given).filter((g): g is NonNullable<Decision['given']> => !!g && g.actual >= 0);

interface Fitted {
  old: number[];
  prev: number[][];
  phase: number[][];
  final: number[][];
  lane: number[][];
  scale: number;
}
function train(decs: Decision[]): Fitted {
  const scale = fit(decs)[J('lane')] || 1;
  const phase = fitPhases(decs);
  return {
    old: fit(decs, OLD),
    prev: fitPhases(decs, PREV).map((th) => normalize(th, scale, FLOORS)),
    phase,
    final: phase.map((th) => normalize(th, scale, FLOORS)),
    // 指定位置后的专用系数：候选都能打这个位置，分路分项几乎不起作用，其余分项的相对重要性也不同
    // 指定位置的系数也套用同样的下限：线上候选是全部英雄，分路系数太小会让不打这个位置的英雄排到前面
    lane: fitPhases(givenOf(decs)).map((th) => normalize(th, scale, FLOORS)),
    scale,
  };
}

function report(test: Decision[], f: Fitted) {
  const methods: [string, string, Scorer<Decision>][] = [
    ['pop', '基线：按赛前出场次数', (d, i) => d.pop[i]],
    ['pop_lane', '基线：出场次数 + 只留有分路位置的英雄', (d, i) => d.pop[i] + (d.laneOk[i] ? 1e6 : 0)],
    ['engine', '手工权重（原有6个分项）', sumOf(OLD)],
    ['fitted', '拟合：只重新拟合原有6个分项的系数', dot(f.old)],
    ['model_prev', '上一版模型（9个分项）', byPhase(f.prev)],
    ['model_phase', '当前模型（11个分项），不设克制下限', byPhase(f.phase)],
    ['model_final', '当前模型（11个分项），克制系数不低于1（线上使用）', byPhase(f.final)],
  ];
  const overall = methods.map(([id, name, sc]) => evaluate(test, id, name, sc));
  const phases: [string, (d: Decision) => boolean][] = [
    ['第1–2手', (d) => d.order <= 2],
    ['第3–6手', (d) => d.order >= 3 && d.order <= 6],
    ['第7–10手（第二轮禁用之后）', (d) => d.order >= 7],
  ];
  const g = givenOf(test);
  const gm: [string, string, Scorer<(typeof g)[number]>][] = [
    ['lane_pop', '基线：按该位置的职业赛出场次数', (d, i) => d.pop[i]],
    ['engine', '手工权重（原有6个分项）', sumOf(OLD)],
    ['model_final', '全部候选上训练的模型', byPhase(f.final)],
    ['model_lane', '指定位置专用系数（线上在“我打某路”时使用）', byPhase(f.lane)],
  ];
  return {
    methods: overall,
    byPhase: phases.map(([phase, fn]) => {
      const sub = test.filter(fn);
      return { phase, n: sub.length, methods: methods.map(([id, name, sc]) => evaluate(sub, id, name, sc)) };
    }),
    laneGiven: { n: g.length, methods: gm.map(([id, name, sc]) => evaluate(g, id, name, sc)) },
  };
}

async function main() {
  const inputs = await loadInputs();
  const { battles, total: fetched } = await loadBattles();
  const names = new Map((await readJson<{ league_id: string; league_name: string }[]>(resolve(ROOT, 'data/raw/kpl/leagues.json'))).map((l) => [l.league_id, l.league_name]));

  const byLeague = new Map<string, Battle[]>();
  for (const b of battles) {
    const arr = byLeague.get(b.league_id) ?? [];
    arr.push(b);
    byLeague.set(b.league_id, arr);
  }
  const leagues = [...byLeague.entries()].sort((a, b) => a[1][0].start_time.localeCompare(b[1][0].start_time));

  // 逐赛事、逐周收集选人决策（分项只依赖当时能看到的数据，和怎么切分训练/测试无关）
  const decsOf = new Map<string, Decision[]>();
  const battlesOf = new Map<string, number>();
  for (const [id, bs] of leagues) {
    const t0 = Date.now();
    const start = new Date(bs[0].start_time.slice(0, 10) + 'T00:00:00Z').getTime();
    const chunks = new Map<number, Battle[]>();
    for (const b of bs) {
      const k = Math.floor((new Date(b.start_time.slice(0, 10) + 'T00:00:00Z').getTime() - start) / (STEP_DAYS * 86400_000));
      chunks.set(k, [...(chunks.get(k) ?? []), b]);
    }
    const used = new Map<string, Set<number>>();
    const decs: Decision[] = [];
    let skipped = false;
    for (const [, cb] of [...chunks.entries()].sort((a, b) => a[0] - b[0])) {
      const asOf = cb[0].start_time.slice(0, 10);
      const snap = computeKpl(battles, inputs.official.heroes, fetched, asOf);
      if (!snap || snap.stats.heat.year.games < 20) {
        skipped = true;
        continue;
      }
      const { bundle } = assemble({ ...inputs, rules: NO_RULES ? [] : inputs.rules, kpl: snap.stats, comps: snap.comps, backtest: null, model: null });
      const engine = makeEngine(bundle);
      const pop = new Map<number, number>();
      for (const b of battles) {
        const d = b.start_time.slice(0, 10);
        if (d >= asOf || d < dayOffset(asOf, HEAT_DAYS)) continue;
        for (const p of b.players) pop.set(p.hero, (pop.get(p.hero) ?? 0) + 1);
      }
      decs.push(...collect(cb, engine, pop, id, used));
    }
    if (decs.length < 500) {
      console.log(`跳过 ${names.get(id) ?? id}：之前的数据不足`);
      continue;
    }
    decsOf.set(id, decs);
    battlesOf.set(id, new Set(bs.filter((b) => !isBlindDecider(b)).map((b) => b.battle_id)).size);
    console.log(`${names.get(id) ?? id}（${bs[0].start_time.slice(0, 10)}起，${bs.length}局，${chunks.size}个统计周期${skipped ? '，开头部分数据不足已跳过' : ''}）：${decs.length}次选人决策，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  const ids = [...decsOf.keys()];
  const pick = (f: (id: string) => boolean) => ids.filter(f).flatMap((id) => decsOf.get(id)!);
  const span = (decs: Decision[]) => ({ from: decs[0]?.date ?? '', to: decs[decs.length - 1]?.date ?? '', picks: decs.length });
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const show = (title: string, r: ReturnType<typeof report>, test: Decision[]) => {
    console.log(`\n${title}：${test[0].date} ~ ${test[test.length - 1].date}，${test.length}次选人决策`);
    for (const m of r.methods) console.log(`  ${m.name.padEnd(30, '　')} Top5 ${pct(m.top5)}  Top10 ${pct(m.top10)}  MRR ${m.mrr.toFixed(3)}`);
    for (const p of r.byPhase) console.log(`  [${p.phase}] n=${p.n}  ` + p.methods.map((m) => `${m.id} ${pct(m.top10)}`).join('  '));
    console.log(`  指定位置后（n=${r.laneGiven.n}）：`);
    for (const m of r.laneGiven.methods) console.log(`    ${m.name.padEnd(28, '　')} Top1 ${pct(m.top1!)}  Top3 ${pct(m.top3!)}  Top5 ${pct(m.top5)}  MRR ${m.mrr.toFixed(3)}`);
  };

  // 切分一：2025训练 → 2026测试
  const trainA = pick((id) => id.startsWith('2025'));
  const testA = pick((id) => id.startsWith('2026'));
  // 切分二：最近一届赛事留出
  const last = ids[ids.length - 1];
  const trainB = pick((id) => id !== last);
  const testB = decsOf.get(last)!;
  if (trainA.length < MIN_TRAIN || !testA.length) throw new Error('训练或测试数据不足');

  const fA = train(trainA);
  const rA = report(testA, fA);
  show('切分一（2025训练，2026测试）', rA, testA);
  const fB = train(trainB);
  const rB = report(testB, fB);
  show(`切分二（最近一届：${names.get(last) ?? last}，用它之前的全部对局训练）`, rB, testB);
  console.log('\n只在2025年上拟合的系数（按阶段，未缩放）：');
  fA.phase.forEach((th, pi) => console.log(`  ${PHASES[pi].name}：`, FEATS.map((k, j) => `${k}=${th[j]}`).join('  ')));

  const get = (r: ReturnType<typeof report>, id: string) => r.methods.find((m) => m.id === id)!;
  const getL = (r: ReturnType<typeof report>, id: string) => r.laneGiven.methods.find((m) => m.id === id)!;
  const adoptModel = get(rA, 'model_final').top10 > get(rA, 'engine').top10 && get(rB, 'model_final').top10 > get(rB, 'engine').top10;
  const adoptLane = getL(rA, 'model_lane').top3! >= getL(rA, 'model_final').top3! && getL(rB, 'model_lane').top3! >= getL(rB, 'model_final').top3!;
  const adoptedReason =
    `采用规则：模型在两种切分的测试集上都比手工权重好才采用。` +
    `2025训练、2026测试：当前模型Top10命中率${pct(get(rA, 'model_final').top10)}，上一版模型${pct(get(rA, 'model_prev').top10)}，手工权重${pct(get(rA, 'engine').top10)}，“出场次数+分路”基线${pct(get(rA, 'pop_lane').top10)}。` +
    `最近一届（${names.get(last) ?? last}）留出：当前模型${pct(get(rB, 'model_final').top10)}，上一版模型${pct(get(rB, 'model_prev').top10)}，手工权重${pct(get(rB, 'engine').top10)}。` +
    (adoptModel ? '模型更好，线上采用。' : '模型没有在两种切分上都更好，线上继续用手工权重。') +
    `不设克制下限时分别为${pct(get(rA, 'model_phase').top10)}和${pct(get(rB, 'model_phase').top10)}：模型学到的克制系数很小，说明机制克制对预测职业队选人帮助不大；网站需要按对方阵容给建议，所以把克制分项保持在手工权重的力度。` +
    `指定位置后（只在能打该位置的英雄里排），最近一届的前3命中率：专用系数${pct(getL(rB, 'model_lane').top3!)}，通用模型${pct(getL(rB, 'model_final').top3!)}，按该位置出场次数排${pct(getL(rB, 'lane_pop').top3!)}；` +
    (adoptLane ? '专用系数不差于通用模型，用户指定位置时采用专用系数。' : '专用系数没有更好，用户指定位置时仍用通用模型。');

  const out: BacktestReport = {
    generatedAt: new Date().toISOString(),
    note: '回测衡量的是“职业队实际选的英雄排在推荐列表的第几位”，目标是模仿职业选择，不代表选得最好，也不能说明在路人局的效果。职业赛是系列赛全局BP，候选集已剔除本队在该系列中用过的英雄；统计数据按周滚动重建，每一周只使用这一周之前的对局。并列名次按中间值计算。',
    train: span(trainA),
    test: { ...span(testA), battles: ids.filter((id) => id.startsWith('2026')).reduce((s, id) => s + battlesOf.get(id)!, 0) },
    methods: rA.methods,
    byPhase: rA.byPhase,
    laneGiven: rA.laneGiven,
    recent: { league: names.get(last) ?? last, train: span(trainB), test: { ...span(testB), battles: battlesOf.get(last)! }, methods: rB.methods, laneGiven: rB.laneGiven },
    adopted: adoptModel ? 'model_final' : 'engine',
    adoptedReason,
  };
  console.log(`\n${adoptedReason}`);
  if (NO_WRITE) return void console.log('（诊断运行，不写入任何文件）');
  await writeJson(resolve(ROOT, 'data/derived/backtest.json'), out);

  // 线上模型：评估用的是“只在训练集上拟合”的系数；确认采用后，用全部对局重新拟合一次作为线上系数
  const all = pick(() => true);
  const fAll = train(all);
  const toPhases = (ths: number[][]) => PHASES.map((p, pi) => ({ ...p, mult: Object.fromEntries(FEATS.map((k, j) => [k, ths[pi][j]])) }));
  const model: PickModel = {
    trainedAt: new Date().toISOString(),
    train: span(all),
    features: FEATS,
    phases: toPhases(fAll.final),
    lanePhases: adoptLane ? toPhases(fAll.lane) : null,
    floors: FLOORS,
    note: '条件logit模型：预测职业队在每一手选了谁。系数非负，按阶段分别拟合，统一缩放到“单组模型里分路匹配的系数=1”。评估见回测；线上系数用全部对局重新拟合。',
  };
  await writeJson(resolve(ROOT, 'data/derived/model.json'), adoptModel ? model : null);
  console.log(adoptModel ? '已写入 data/derived/model.json' : '模型未被采用，model.json 置空');
  fAll.final.forEach((th, pi) => console.log(`线上系数（${PHASES[pi].name}）：`, FEATS.map((k, j) => `${k}=${th[j]}`).join('  ')));
  if (adoptLane) fAll.lane.forEach((th, pi) => console.log(`指定位置系数（${PHASES[pi].name}）：`, FEATS.map((k, j) => `${k}=${th[j]}`).join('  ')));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
