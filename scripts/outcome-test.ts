// 胜负检验：网站对阵容的评估（克制、配合、职业赛数据）和职业赛的实际胜负有没有关系。
//
// 做法：对每一局，用“这一周之前的数据”重建引擎，计算蓝方减红方的阵容差值，再看它能不能预测蓝方是否获胜。
// 队伍强弱是最大的混杂因素，所以同时计算滚动Elo，并比较“只用Elo”和“Elo+阵容差值”的预测效果。
// 这是内部检验，不在网站上展示任何英雄胜率。
//
// 用法：tsx scripts/outcome-test.ts [--step-days=7]
import { resolve } from 'node:path';
import { ROOT, writeJson } from './lib/http.ts';
import { POS_TO_LANE, loadBattles, type Battle } from './lib/kpl.ts';
import { computeKpl } from './lib/kpl-stats.ts';
import { assemble, loadInputs } from './lib/assemble.ts';
import { makeEngine } from '../src/lib/data.ts';
import { RESP_SMOOTH, respKey, type Engine } from '../src/engine/recommend.ts';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const STEP_DAYS = Number(arg('step-days') ?? 7);
const FEATS = ['elo', 'counter', 'counterOfficial', 'synergy', 'meta', 'lanePick', 'proVs'] as const;
type Feat = (typeof FEATS)[number];
const NAME: Record<Feat, string> = {
  elo: '队伍Elo差',
  counter: '克制净值（全部证据）',
  counterOfficial: '克制净值（只算官方说明）',
  synergy: '队内配合差',
  meta: '职业赛第一局出场率差',
  lanePick: '职业赛该位置选取率差',
  proVs: '职业赛针对选择差',
};

interface Row {
  /** 每条规则、每类证据的净次数（蓝方减红方） */
  detail: Record<string, number>;
  league: string;
  date: string;
  y: number; // 蓝方获胜=1
  x: Record<Feat, number>;
}

function features(b: Battle, engine: Engine): (Omit<Row['x'], 'elo'> & { detail: Record<string, number> }) | null {
  const team = (camp: 1 | 2) => b.players.filter((p) => p.camp === camp && engine.byId.has(p.hero));
  const blue = team(1);
  const red = team(2);
  if (blue.length !== 5 || red.length !== 5) return null;
  const { rel } = engine;
  let counter = 0;
  let counterOfficial = 0;
  let proVs = 0;
  const ll = (c: number, o: number) => {
    const r = engine.resp.vs.get(respKey(c, o));
    return r ? Math.log((r[0] + RESP_SMOOTH) / (r[1] + RESP_SMOOTH)) : 0;
  };
  const detail: Record<string, number> = {};
  const add = (k: string, v: number) => (detail[k] = (detail[k] ?? 0) + v);
  const tally = (a: number, e: number, sign: number) => {
    for (const ev of rel.getCounter(a, e)?.evidence ?? []) add(ev.kind === 'rule' ? `规则:${ev.rule.id}` : `证据:${ev.kind}`, sign);
  };
  const official = (a: number, e: number) => (rel.getCounter(a, e)?.evidence.some((x) => x.kind === 'official') ? 1 : 0);
  for (const a of blue)
    for (const e of red) {
      counter += rel.net(a.hero, e.hero);
      tally(a.hero, e.hero, 1);
      tally(e.hero, a.hero, -1);
      counterOfficial += official(a.hero, e.hero) - official(e.hero, a.hero);
      proVs += ll(a.hero, e.hero) - ll(e.hero, a.hero);
    }
  const syn = (t: typeof blue) => {
    let s = 0;
    for (let i = 0; i < 5; i++)
      for (let j = i + 1; j < 5; j++) {
        const r = rel.getSynergy(t[i].hero, t[j].hero);
        s += r?.weight ?? 0;
        for (const ev of r?.evidence ?? []) add(ev.kind === 'rule' ? `配合规则:${ev.rule.id}` : `配合证据:${ev.kind}`, t === blue ? 1 : -1);
      }
    return s;
  };
  const meta = (t: typeof blue) => t.reduce((s, p) => s + (engine.meta.get(p.hero)?.presence ?? 0), 0);
  const games = engine.bundle.kpl?.pairs.teamGames || 1;
  const lanePick = (t: typeof blue) =>
    t.reduce((s, p) => {
      const lane = POS_TO_LANE[p.pos_desc];
      return s + (lane ? (engine.byId.get(p.hero)!.kpl?.lanesYear?.[lane - 1] ?? 0) / games : 0);
    }, 0);
  return { detail, counter, counterOfficial, synergy: syn(blue) - syn(red), meta: meta(blue) - meta(red), lanePick: lanePick(blue) - lanePick(red), proVs };
}

/** 逻辑回归（特征先标准化），返回系数与预测函数 */
function logit(rows: Row[], keys: Feat[]) {
  const mu = keys.map((k) => rows.reduce((s, r) => s + r.x[k], 0) / rows.length);
  const sd = keys.map((k, j) => Math.sqrt(rows.reduce((s, r) => s + (r.x[k] - mu[j]) ** 2, 0) / rows.length) || 1);
  const z = (r: Row) => keys.map((k, j) => (r.x[k] - mu[j]) / sd[j]);
  const w = new Array(keys.length + 1).fill(0);
  const X = rows.map(z);
  for (let it = 0; it < 2000; it++) {
    const g = new Array(w.length).fill(0);
    rows.forEach((r, i) => {
      const p = 1 / (1 + Math.exp(-(w[0] + X[i].reduce((s, v, j) => s + v * w[j + 1], 0))));
      g[0] += r.y - p;
      X[i].forEach((v, j) => (g[j + 1] += (r.y - p) * v));
    });
    for (let j = 0; j < w.length; j++) w[j] += (0.5 * g[j]) / rows.length - (j ? 1e-3 * w[j] : 0);
  }
  return { w, predict: (r: Row) => 1 / (1 + Math.exp(-(w[0] + z(r).reduce((s, v, j) => s + v * w[j + 1], 0)))) };
}

function auc(ps: number[], ys: number[]) {
  const idx = ps.map((p, i) => [p, ys[i]] as const).sort((a, b) => a[0] - b[0]);
  let rankSum = 0;
  let pos = 0;
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j < idx.length && idx[j][0] === idx[i][0]) j++;
    const avg = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) if (idx[k][1] === 1) { rankSum += avg; pos++; }
    i = j;
  }
  const neg = idx.length - pos;
  return pos && neg ? (rankSum - (pos * (pos + 1)) / 2) / (pos * neg) : NaN;
}

async function main() {
  const inputs = await loadInputs();
  const { battles, total } = await loadBattles();
  const rows: Row[] = [];
  const elo = new Map<string, number>();
  const rating = (t: string) => elo.get(t) ?? 1500;
  const first = new Date(battles[0].start_time.slice(0, 10) + 'T00:00:00Z').getTime();
  let chunk = -1;
  let engine: Engine | null = null;
  for (const b of battles) {
    const k = Math.floor((new Date(b.start_time.slice(0, 10) + 'T00:00:00Z').getTime() - first) / (STEP_DAYS * 86400_000));
    if (k !== chunk) {
      chunk = k;
      const snap = computeKpl(battles, inputs.official.heroes, total, b.start_time.slice(0, 10));
      engine = snap && snap.stats.heat.year.games >= 20 ? makeEngine(assemble({ ...inputs, kpl: snap.stats, comps: snap.comps, backtest: null, model: null }).bundle) : null;
    }
    const y = b.win_camp === 1 ? 1 : b.win_camp === 2 ? 0 : -1;
    if (y < 0) continue;
    const ra = rating(b.camp1_team);
    const rb = rating(b.camp2_team);
    if (engine) {
      const f = features(b, engine);
      if (f) {
        const { detail, ...x } = f;
        rows.push({ league: b.league_id, date: b.start_time.slice(0, 10), y, detail, x: { elo: ra - rb, ...x } });
      }
    }
    const exp = 1 / (1 + 10 ** ((rb - ra) / 400));
    elo.set(b.camp1_team, ra + 20 * (y - exp));
    elo.set(b.camp2_team, rb - 20 * (y - exp));
  }
  const train = rows.filter((r) => r.league.startsWith('2025'));
  const test = rows.filter((r) => r.league.startsWith('2026'));
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`有效对局 ${rows.length}（训练 ${train.length}：${train[0]?.date}~${train[train.length - 1]?.date}；测试 ${test.length}：${test[0]?.date}~${test[test.length - 1]?.date}）`);
  console.log(`测试集蓝方胜率 ${pct(test.reduce((s, r) => s + r.y, 0) / test.length)}`);

  const evalSet = (keys: Feat[]) => {
    const m = logit(train, keys);
    const ps = test.map(m.predict);
    const ys = test.map((r) => r.y);
    const acc = ps.filter((p, i) => (p >= 0.5 ? 1 : 0) === ys[i]).length / ps.length;
    const ll = -ps.reduce((s, p, i) => s + (ys[i] ? Math.log(p) : Math.log(1 - p)), 0) / ps.length;
    return { keys, acc: +acc.toFixed(4), logloss: +ll.toFixed(4), auc: +auc(ps, ys).toFixed(4), coef: Object.fromEntries(keys.map((k, j) => [k, +m.w[j + 1].toFixed(3)])) };
  };
  const models = [evalSet([]), evalSet(['elo']), ...FEATS.slice(1).map((k) => evalSet(['elo', k])), evalSet([...FEATS]), evalSet(FEATS.slice(1) as Feat[])];
  const label = (keys: Feat[]) => (keys.length === 0 ? '只有截距（蓝方优势）' : keys.length === FEATS.length ? 'Elo + 全部阵容差值' : keys.length === FEATS.length - 1 ? '全部阵容差值（不含Elo）' : keys.map((k) => NAME[k]).join(' + '));
  console.log('\n逻辑回归（2025训练，2026测试；系数为标准化后的）：');
  for (const m of models) console.log(`  ${label(m.keys).padEnd(34, '　')} 准确率 ${pct(m.acc)}  AUC ${m.auc.toFixed(3)}  对数损失 ${m.logloss.toFixed(4)}  ${Object.entries(m.coef).map(([k, v]) => `${k}=${v}`).join(' ')}`);

  // 不依赖模型的直接统计：某项差值占优的一方的胜率（全部有效对局）
  console.log('\n差值占优一方的胜率（全部有效对局，差值为0的不计）：');
  const direct = FEATS.map((k) => {
    const sub = rows.filter((r) => r.x[k] !== 0);
    const wins = sub.filter((r) => (r.x[k] > 0 ? 1 : 0) === r.y).length;
    const p = wins / sub.length;
    const se = Math.sqrt((p * (1 - p)) / sub.length);
    console.log(`  ${NAME[k].padEnd(22, '　')} ${pct(p)}（n=${sub.length}，95%区间 ${pct(p - 1.96 * se)}–${pct(p + 1.96 * se)}）`);
    return { key: k, name: NAME[k], n: sub.length, winRate: +p.toFixed(4), lo: +(p - 1.96 * se).toFixed(4), hi: +(p + 1.96 * se).toFixed(4) };
  });
  // 逐条规则、逐类证据：净次数占优一方的胜率
  console.log('\n逐条规则/证据：该项净次数占优一方的胜率（全部有效对局）：');
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.detail)))].sort();
  const byRule = keys.map((k) => {
    const sub = rows.filter((r) => (r.detail[k] ?? 0) !== 0);
    const wins = sub.filter((r) => (r.detail[k] > 0 ? 1 : 0) === r.y).length;
    const p = sub.length ? wins / sub.length : NaN;
    const se = Math.sqrt((p * (1 - p)) / Math.max(1, sub.length));
    console.log(`  ${k.padEnd(36)} ${pct(p)}（n=${sub.length}，95%区间 ${pct(p - 1.96 * se)}–${pct(p + 1.96 * se)}）`);
    return { key: k, n: sub.length, winRate: +p.toFixed(4), lo: +(p - 1.96 * se).toFixed(4), hi: +(p + 1.96 * se).toFixed(4) };
  });
  await writeJson(resolve(ROOT, 'data/derived/outcome-test.json'), {
    generatedAt: new Date().toISOString(),
    note: '检验阵容差值与职业赛胜负的关系。队伍强弱用滚动Elo控制。统计数据按周滚动重建，每一局只使用它之前的数据。',
    games: rows.length,
    train: { n: train.length, from: train[0]?.date, to: train[train.length - 1]?.date },
    test: { n: test.length, from: test[0]?.date, to: test[test.length - 1]?.date, blueWinRate: +(test.reduce((s, r) => s + r.y, 0) / test.length).toFixed(4) },
    models: models.map((m) => ({ name: label(m.keys), ...m })),
    direct,
    byRule,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
