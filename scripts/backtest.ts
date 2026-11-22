// 回测：用职业赛历史对局检验推荐排序。
//
// 衡量的是“职业队实际选的英雄排在推荐列表的第几位”——目标是模仿职业选择，不代表选得最好，
// 也不能说明在路人局的效果。它的用处是：①确认引擎没有明显跑偏；②比较各分项是否带来增益。
//
// 防止数据泄漏：
//   - 按赛事切分。对每个赛事，只用该赛事开打之前的对局重建KPL统计（热度、分路、同队共现）。
//   - 候选集剔除本局已禁已选的英雄，以及本系列赛中本队已用过的英雄（全局BP）。
//   - BO7第7局（盲选）不参与。
//   - 官方公告的增强/削弱不参与（数据包只有最近的公告，对历史对局不成立）。
// 仍存在的偏差：官方关系和机制标签用的是当前版本的技能原文，历史版本的技能可能不同。
//
// 用法：tsx scripts/backtest.ts [--test-year=2026] [--train-year=2025]
import { resolve } from 'node:path';
import { ROOT, readJson, writeJson } from './lib/http.ts';
import { isBlindDecider, loadBattles, type Battle } from './lib/kpl.ts';
import { computeKpl, dayOffset, HEAT_DAYS } from './lib/kpl-stats.ts';
import { assemble, loadInputs } from './lib/assemble.ts';
import { makeEngine } from '../src/lib/data.ts';
import { newDraft, place, type DraftState, type Side } from '../src/engine/draft.ts';
import { DEFAULT_WEIGHTS, recommendPicks, type Engine, type PartKey } from '../src/engine/recommend.ts';
import type { BacktestMethod, BacktestReport, PickModel } from '../src/types.ts';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const TEST_YEAR = arg('test-year') ?? '2026';
const TRAIN_YEAR = arg('train-year') ?? '2025';
// 也可以直接指定赛事ID（逗号分隔），用于诊断
const TEST_LEAGUES = arg('test-leagues')?.split(',');
const TRAIN_LEAGUES = arg('train-leagues')?.split(',');
const isTestLeague = (id: string) => (TEST_LEAGUES ? TEST_LEAGUES.includes(id) : id.startsWith(TEST_YEAR));
const isTrainLeague = (id: string) => !isTestLeague(id) && (TRAIN_LEAGUES ? TRAIN_LEAGUES.includes(id) : id.startsWith(TRAIN_YEAR));
const NO_RULES = process.argv.includes('--no-rules');
const NO_WRITE = process.argv.includes('--no-write') || NO_RULES || !!TEST_LEAGUES || !!TRAIN_LEAGUES;
const MIN_TRAIN = Number(arg('min-train') ?? 2000);

const FEATS: PartKey[] = ['counter', 'synergy', 'needs', 'lane', 'meta', 'exposure', 'proVs', 'proAlly', 'lanePick'];
/** 手工权重使用的分项（新增的三个职业赛分项只在训练模型里使用） */
const OLD: PartKey[] = ['counter', 'synergy', 'needs', 'lane', 'meta', 'exposure'];
const PHASES: { name: string; fromOrder: number; toOrder: number }[] = [
  { name: '第1–2手', fromOrder: 1, toOrder: 2 },
  { name: '第3–6手', fromOrder: 3, toOrder: 6 },
  { name: '第7–10手', fromOrder: 7, toOrder: 10 },
];
const phaseOf = (order: number) => PHASES.findIndex((p) => order >= p.fromOrder && order <= p.toOrder);
/** 克制分项系数的下限。系数已按“单组模型里分路匹配的系数=1”缩放，所以 1 表示保持手工权重的力度。
 *  训练目标是模仿职业队选人，学到的克制系数很小；网站的用途是按对方阵容给建议，所以克制分项不低于手工权重。
 *  下限对回测指标的影响单独报告（model_phase 对比 model_final）。 */
// 分路匹配也设下限：开局前两手队友还没选人，分路分项对所有英雄都一样，学到的系数是0；
// 但用户指定“我打某路”时这个分项必须生效。
const FLOORS: Record<string, number> = { counter: 1, lane: 1 };

interface Decision {
  league: string;
  date: string;
  /** 本局第几手选人（1–10） */
  order: number;
  /** 候选英雄ID */
  cands: number[];
  /** 每个候选的分项得分，按 FEATS 顺序展开 */
  x: Float32Array;
  /** 每个候选在赛前窗口内的出场次数 */
  pop: Float32Array;
  /** 分路是否有位置（1/0） */
  laneOk: Uint8Array;
  actual: number; // 实际所选在 cands 中的下标，-1 表示不在候选里
}

function collect(battles: Battle[], engine: Engine, pop: Map<number, number>, league: string): Decision[] {
  const out: Decision[] = [];
  const used = new Map<string, Set<number>>(); // 系列赛+队伍 → 已用英雄
  const noPatch = { ...DEFAULT_WEIGHTS, patch: 0 };
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
        const recs = recommendPicks(engine, d, { side, weights: noPatch, mult: {} }).filter((r) => !usedSet.has(r.hero.id) && !r.hero.isLimited);
        const n = recs.length;
        const x = new Float32Array(n * FEATS.length);
        const p = new Float32Array(n);
        const laneOk = new Uint8Array(n);
        recs.forEach((r, i) => {
          FEATS.forEach((k, j) => (x[i * FEATS.length + j] = r.parts.find((q) => q.key === k)?.value ?? 0));
          p[i] = pop.get(r.hero.id) ?? 0;
          laneOk[i] = (r.parts.find((q) => q.key === 'lane')?.value ?? 0) > DEFAULT_WEIGHTS.laneMiss ? 1 : 0;
        });
        out.push({ league, date: b.start_time.slice(0, 10), order, cands: recs.map((r) => r.hero.id), x, pop: p, laneOk, actual: recs.findIndex((r) => r.hero.id === step.hero) });
      }
      if (pickIdx[side] < 5) d = place(d, { side, kind: 'pick', index: pickIdx[side]++ }, step.hero);
      usedSet.add(step.hero);
    }
  }
  return out;
}

type Scorer = (dec: Decision, i: number) => number;

/** 实际所选英雄的名次（1起）；并列时取中间名次，避免并列被算成第一 */
function rankOf(dec: Decision, score: Scorer): number {
  if (dec.actual < 0) return Infinity;
  const s = score(dec, dec.actual);
  let better = 0;
  let equal = 0;
  for (let i = 0; i < dec.cands.length; i++) {
    if (i === dec.actual) continue;
    const v = score(dec, i);
    if (v > s) better++;
    else if (v === s) equal++;
  }
  return better + 1 + equal / 2;
}

function evaluate(decs: Decision[], id: string, name: string, score: Scorer): BacktestMethod {
  let t5 = 0;
  let t10 = 0;
  let rr = 0;
  for (const d of decs) {
    const r = rankOf(d, score);
    if (r <= 5) t5++;
    if (r <= 10) t10++;
    rr += 1 / r;
  }
  const n = Math.max(1, decs.length);
  return { id, name, top5: +(t5 / n).toFixed(4), top10: +(t10 / n).toFixed(4), mrr: +(rr / n).toFixed(4) };
}

const feat = (d: Decision, i: number, k: PartKey) => d.x[i * FEATS.length + FEATS.indexOf(k)];
const total = (d: Decision, i: number, keys: PartKey[] = OLD) => keys.reduce((s, k) => s + feat(d, i, k), 0);

/** 条件 logit：P(选 i) ∝ exp(θ·x_i)。用 Adam 做梯度上升，带很小的 L2 正则。 */
function fit(decs: Decision[], keys: PartKey[] = FEATS, iters = 300): number[] {
  const K = FEATS.length;
  const on = FEATS.map((k) => keys.includes(k));
  const theta: number[] = FEATS.map((_, k) => (on[k] ? 0.1 : 0));
  const m = new Array(K).fill(0);
  const v = new Array(K).fill(0);
  const usable = decs.filter((d) => d.actual >= 0);
  for (let it = 1; it <= iters; it++) {
    const g = new Array(K).fill(0);
    for (const d of usable) {
      const n = d.cands.length;
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
      // 系数限制为非负：每个分项的方向在引擎里已经定好（加分为正、减分为负），不允许模型把方向反过来
      theta[k] = Math.max(0, theta[k] + (0.02 * (m[k] / (1 - 0.9 ** it))) / (Math.sqrt(v[k] / (1 - 0.999 ** it)) + 1e-8));
    }
  }
  return theta.map((t) => +t.toFixed(4));
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
  const leagues = [...byLeague.entries()].filter(([id]) => isTestLeague(id) || isTrainLeague(id)).sort((a, b) => a[1][0].start_time.localeCompare(b[1][0].start_time));

  const train: Decision[] = [];
  const test: Decision[] = [];
  let testBattles = 0;
  for (const [id, bs] of leagues) {
    const asOf = bs[0].start_time.slice(0, 10);
    const snap = computeKpl(battles, inputs.official.heroes, fetched, asOf);
    if (!snap || snap.stats.heat.year.games < 20) {
      console.log(`跳过 ${names.get(id) ?? id}：开赛（${asOf}）之前的数据不足`);
      continue;
    }
    const { bundle } = assemble({ ...inputs, rules: NO_RULES ? [] : inputs.rules, kpl: snap.stats, comps: snap.comps, backtest: null });
    const engine = makeEngine(bundle);
    // 赛前窗口内的出场次数（基线用）
    const pop = new Map<number, number>();
    for (const b of battles) {
      const d = b.start_time.slice(0, 10);
      if (d >= asOf || d < dayOffset(asOf, HEAT_DAYS)) continue;
      for (const p of b.players) pop.set(p.hero, (pop.get(p.hero) ?? 0) + 1);
    }
    const t0 = Date.now();
    const decs = collect(bs, engine, pop, id);
    const isTest = isTestLeague(id);
    (isTest ? test : train).push(...decs);
    if (isTest) testBattles += bs.filter((b) => !isBlindDecider(b)).length;
    console.log(`${isTest ? '测试' : '训练'} ${names.get(id) ?? id}（${asOf}起，${bs.length}局）：${decs.length}次选人决策，赛前第一局样本 ${snap.stats.heat.year.games} 局，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  if (!test.length) throw new Error('没有可用的测试数据（需要测试年份之前的对局来重建赛前统计）');

  const theta = train.length >= MIN_TRAIN ? fit(train, OLD) : null;
  if (theta) console.log('拟合得到的分项系数（原有6个分项）：', OLD.map((k) => `${k}=${theta[FEATS.indexOf(k)]}`).join('  '));
  // 训练模型：全部9个分项；一组系数，或按阶段各一组
  const dot = (th: number[]) => (d: Decision, i: number) => FEATS.reduce((s, _, j) => s + th[j] * d.x[i * FEATS.length + j], 0);
  const fitPhases = (decs: Decision[]) => PHASES.map((_, pi) => fit(decs.filter((d) => phaseOf(d.order) === pi)));
  /** 统一缩放（除以单组模型里“分路匹配”的系数），并应用下限 */
  const normalize = (th: number[], scale: number, floors: Record<string, number>) => FEATS.map((k, j) => +Math.max(th[j] / scale, floors[k] ?? 0).toFixed(3));
  const theta9 = theta ? fit(train) : null;
  const thetaPh = theta ? fitPhases(train) : null;
  if (theta9) console.log('训练模型系数（9个分项，单组）：', FEATS.map((k, i) => `${k}=${theta9[i]}`).join('  '));
  if (thetaPh) thetaPh.forEach((th, pi) => console.log(`训练模型系数（${PHASES[pi].name}）：`, FEATS.map((k, i) => `${k}=${th[i]}`).join('  ')));
  else console.log(`训练决策数 ${train.length} 不足${MIN_TRAIN}，不做权重拟合`);

  const methods: [string, string, Scorer][] = [
    ['pop', '基线：按赛前出场次数', (d, i) => d.pop[i]],
    ['pop_lane', '基线：出场次数 + 只留有分路位置的英雄', (d, i) => d.pop[i] + (d.laneOk[i] ? 1e6 : 0)],
    ['engine', '手工权重（原有6个分项）', (d, i) => total(d, i)],
    ['engine_no_rel', '引擎：去掉克制、配合、先手暴露', (d, i) => total(d, i, ['needs', 'lane', 'meta'])],
    ['engine_no_meta', '引擎：去掉职业赛热度', (d, i) => total(d, i, ['counter', 'synergy', 'needs', 'lane', 'exposure'])],
    ['engine_rel_only', '引擎：只用克制、配合、先手暴露和分路', (d, i) => total(d, i, ['counter', 'synergy', 'exposure', 'lane'])],
    ['base_counter', '诊断：热度+分路+需求，再加克制', (d, i) => total(d, i, ['needs', 'lane', 'meta', 'counter'])],
    ['base_synergy', '诊断：热度+分路+需求，再加配合', (d, i) => total(d, i, ['needs', 'lane', 'meta', 'synergy'])],
    ['base_exposure', '诊断：热度+分路+需求，再加先手暴露', (d, i) => total(d, i, ['needs', 'lane', 'meta', 'exposure'])],
    ['lane_meta', '诊断：只用热度+分路', (d, i) => total(d, i, ['lane', 'meta'])],
    ...[0.15, 0.25, 0.4, 0.6].map((k): [string, string, Scorer] => [`scaled_${k}`, `诊断：热度+分路 + ${k}×(克制+配合+暴露+需求)`, (d, i) => total(d, i, ['lane', 'meta']) + k * total(d, i, ['counter', 'synergy', 'exposure', 'needs'])]),
  ];
  if (theta && theta9 && thetaPh) {
    const byPhase = (ths: number[][]) => (d: Decision, i: number) => dot(ths[phaseOf(d.order)])(d, i);
    methods.push(
      ['fitted', '拟合：只重新拟合原有6个分项的系数', dot(theta)],
      ['model9', '模型：9个分项，单组系数', dot(theta9)],
      ['model_phase', '模型：9个分项，按阶段各一组系数', byPhase(thetaPh)],
      ...[0.5, 1, 1.5].map((f): [string, string, Scorer] => [f === FLOORS.counter ? 'model_final' : `model_floor_${f}`, `模型：按阶段系数，克制系数不低于${f}${f === FLOORS.counter ? '（线上使用）' : ''}`, byPhase(thetaPh.map((th) => normalize(th, theta9[FEATS.indexOf('lane')], { ...FLOORS, counter: f })))]),
    );
  }

  const evalAll = (decs: Decision[]) => methods.map(([id, name, sc]) => evaluate(decs, id, name, sc));
  const overall = evalAll(test);
  const phases: [string, (d: Decision) => boolean][] = [
    ['第1–2手', (d) => d.order <= 2],
    ['第3–6手', (d) => d.order >= 3 && d.order <= 6],
    ['第7–10手（第二轮禁用之后）', (d) => d.order >= 7],
  ];

  const get = (id: string) => overall.find((m) => m.id === id)!;
  const engineM = get('engine');
  const laneMeta = get('lane_meta');
  const base = get('pop_lane');
  const pp = (x: number) => `${(x * 100).toFixed(1)}%`;
  const hasModel = !!(theta && theta9 && thetaPh);
  const finalM = hasModel ? get('model_final') : null;
  const freeM = hasModel ? get('model_phase') : null;
  // 采用规则：训练模型在测试集上的Top10命中率高于手工权重才采用
  const adoptModel = !!finalM && finalM.top10 > engineM.top10;
  const adoptedReason = finalM && freeM
    ? `训练模型（9个分项、按阶段拟合、克制系数不低于${FLOORS.counter}）在测试集上的Top10命中率为${pp(finalM.top10)}，手工权重为${pp(engineM.top10)}，“出场次数+分路”基线为${pp(base.top10)}。` +
      (adoptModel ? '模型更好，线上采用模型。' : '模型没有更好，线上继续用手工权重。') +
      `不设克制下限时为${pp(freeM.top10)}：模型学到的克制系数很小，说明机制克制对预测职业队选人帮助不大；网站需要按对方阵容给建议，所以把克制分项保持在手工权重的力度，代价是${((freeM.top10 - finalM.top10) * 100).toFixed(1)}个百分点。`
    : `手工权重的Top10命中率为${pp(engineM.top10)}，只用热度和分路为${pp(laneMeta.top10)}。训练数据不足，没有训练模型。`;
  const report: BacktestReport = {
    generatedAt: new Date().toISOString(),
    note: '回测衡量的是“职业队实际选的英雄排在推荐列表的第几位”，目标是模仿职业选择，不代表选得最好，也不能说明在路人局的效果。职业赛是系列赛全局BP，候选集已剔除本队在该系列中用过的英雄；每个赛事只使用开赛之前的数据。并列名次按中间值计算。',
    train: train.length ? { from: train[0].date, to: train[train.length - 1].date, picks: train.length } : { from: '', to: '', picks: 0 },
    test: { from: test[0].date, to: test[test.length - 1].date, picks: test.length, battles: testBattles },
    methods: overall,
    byPhase: phases.map(([phase, f]) => {
      const sub = test.filter(f);
      return { phase, n: sub.length, methods: evalAll(sub) };
    }),
    adopted: adoptModel ? 'model_final' : 'engine',
    adoptedReason,
  };
  if (theta) (report as BacktestReport & { fittedTheta?: Record<string, number> }).fittedTheta = Object.fromEntries(OLD.map((k) => [k, theta[FEATS.indexOf(k)]]));
  // 线上模型：评估用的是“只在训练集上拟合”的系数；确认采用后，用全部对局（训练+测试）重新拟合一次作为线上系数
  if (hasModel && !NO_WRITE) {
    const all = [...train, ...test];
    const scale = fit(all)[FEATS.indexOf('lane')] || 1;
    const final = fitPhases(all).map((th) => normalize(th, scale, FLOORS));
    const model: PickModel = {
      trainedAt: new Date().toISOString(),
      train: { from: all[0].date, to: all[all.length - 1].date, picks: all.length },
      features: FEATS,
      phases: PHASES.map((p, pi) => ({ ...p, mult: Object.fromEntries(FEATS.map((k, j) => [k, final[pi][j]])) })),
      floors: FLOORS,
      note: '条件logit模型：预测职业队在每一手选了谁。系数非负，按阶段分别拟合，统一缩放到“单组模型里分路匹配的系数=1”。评估见回测；线上系数用全部对局重新拟合。',
    };
    await writeJson(resolve(ROOT, 'data/derived/model.json'), adoptModel ? model : null);
    console.log(adoptModel ? '已写入 data/derived/model.json' : '模型未被采用，model.json 置空');
    final.forEach((th, pi) => console.log(`线上系数（${PHASES[pi].name}）：`, FEATS.map((k, j) => `${k}=${th[j]}`).join('  ')));
  }
  if (!NO_WRITE) await writeJson(resolve(ROOT, 'data/derived/backtest.json'), report);
  else console.log('（诊断运行，不写入 backtest.json）');

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`\n测试集：${report.test.from} ~ ${report.test.to}，${report.test.battles}局，${report.test.picks}次选人决策`);
  for (const m of overall) console.log(`  ${m.name.padEnd(28, '　')} Top5 ${pct(m.top5)}  Top10 ${pct(m.top10)}  MRR ${m.mrr.toFixed(3)}`);
  for (const p of report.byPhase) console.log(`  [${p.phase}] n=${p.n}  ` + p.methods.map((m) => `${m.id} ${pct(m.top10)}`).join('  '));
  console.log(report.adoptedReason);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
