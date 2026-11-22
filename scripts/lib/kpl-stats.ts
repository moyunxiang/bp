// KPL聚合统计的计算。只计算受“系列赛内全局BP”偏差影响较小的统计量，不计算任何胜率：
//   - 系列第一局禁选次数：每个系列赛第一局不受全局BP影响
//   - 分路分布：选手实际分路
//   - 同队共现提升度：lift = 实际同队次数 / 独立假设下的期望次数（样本≥30才输出）
//   - 常见三人组合与完整阵容的出现次数
// asOf 用于回测：只使用该日期之前的对局，重建“当时能看到的数据”。
import type { KplComps, KplStats, OfficialHero } from '../../src/types.ts';
import { POS_TO_LANE, isBlindDecider, type Battle } from './kpl.ts';
import { RESP_SMOOTH } from '../../src/engine/recommend.ts';

export const HEAT_DAYS = 150; // 第一局禁选的近期窗口
export const LANE_DAYS = 500; // 分路分布窗口
export const PAIR_DAYS = 365; // 共现窗口
export const PAIR_MIN_N = 30;
export const TRIO_MIN_N = 12;
export const LINEUP_MIN_N = 3;
/** 选人响应统计：期望次数低于这个值的英雄对不输出（样本太少） */
export const RESP_MIN_EXP = 1.5;

/**
 * 选人响应统计（供选人模型使用）：按BP顺序逐手统计“对面已亮出 e / 队友已选 a 之后，c 被选了多少次”，
 * 并与“只看 c 在同一赛事里的平均被选概率”得到的期望次数比较。
 * 期望值只在 c 当时可选（没被禁、没被选、本队本系列没用过）的那些选人回合上累计，所以不受全局BP和禁用的影响。
 * 这是职业队的选人行为，不是胜负，也不等于机制上的克制。
 */
function computeResp(battles: Battle[], known: Set<number>) {
  const ids = [...known];
  const used = new Map<string, Set<number>>();
  type Dec = { league: string; chosen: number; avail: number[]; enemies: number[]; allies: number[] };
  const decs: Dec[] = [];
  for (const b of battles) {
    const banned = new Set<number>();
    const picked: Record<1 | 2, number[]> = { 1: [], 2: [] };
    for (const x of b.bp) {
      if (!(x.hero > 0)) continue;
      if (!x.pick) {
        banned.add(x.hero);
        continue;
      }
      const key = `${b.match_id}|${x.camp === 1 ? b.camp1_team : b.camp2_team}`;
      const u = used.get(key) ?? new Set<number>();
      used.set(key, u);
      if (known.has(x.hero)) {
        const taken = new Set([...banned, ...picked[1], ...picked[2], ...u]);
        decs.push({ league: b.league_id, chosen: x.hero, avail: ids.filter((h) => !taken.has(h) || h === x.hero), enemies: [...picked[x.camp === 1 ? 2 : 1]], allies: [...picked[x.camp]] });
      }
      picked[x.camp].push(x.hero);
      u.add(x.hero);
    }
  }
  // 每个赛事里，英雄在“可选的回合”中被选中的平均概率
  const P = new Map<string, number>();
  const A = new Map<string, number>();
  for (const d of decs) {
    P.set(`${d.league}|${d.chosen}`, (P.get(`${d.league}|${d.chosen}`) ?? 0) + 1);
    for (const h of d.avail) A.set(`${d.league}|${h}`, (A.get(`${d.league}|${h}`) ?? 0) + 1);
  }
  const rate = (league: string, h: number) => (P.get(`${league}|${h}`) ?? 0) / Math.max(1, A.get(`${league}|${h}`) ?? 0);
  const acc = () => ({ obs: new Map<number, number>(), exp: new Map<number, number>() });
  const vs = acc();
  const ally = acc();
  const K = 1000; // 英雄ID都小于1000
  for (const d of decs) {
    for (const [tbl, others] of [[vs, d.enemies], [ally, d.allies]] as const) {
      for (const o of others) {
        if (!known.has(o)) continue;
        tbl.obs.set(d.chosen * K + o, (tbl.obs.get(d.chosen * K + o) ?? 0) + 1);
        for (const h of d.avail) {
          const r = rate(d.league, h);
          if (r > 0) tbl.exp.set(h * K + o, (tbl.exp.get(h * K + o) ?? 0) + r);
        }
      }
    }
  }
  const toList = (t: ReturnType<typeof acc>): [number, number, number, number][] =>
    [...t.exp.entries()]
      // 只保留样本够、且与期望有明显差别的英雄对（差别很小的对模型没有贡献，省掉可以减小数据包）
      .filter(([k, e]) => e >= RESP_MIN_EXP && Math.abs(Math.log(((t.obs.get(k) ?? 0) + RESP_SMOOTH) / (e + RESP_SMOOTH))) >= 0.15)
      .map(([k, e]): [number, number, number, number] => [Math.floor(k / K), k % K, t.obs.get(k) ?? 0, +e.toFixed(2)])
      .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return { decisions: decs.length, vs: toList(vs), ally: toList(ally) };
}

export const dayOffset = (date: string, days: number) => new Date(new Date(date.slice(0, 10) + 'T00:00:00Z').getTime() - days * 86400_000).toISOString().slice(0, 10);

export function computeKpl(all: Battle[], heroes: Pick<OfficialHero, 'id'>[], totalFetched: number, asOf?: string): { stats: KplStats; comps: KplComps } | null {
  const known = new Set(heroes.map((h) => h.id));
  const battles = asOf ? all.filter((b) => b.start_time.slice(0, 10) < asOf) : all;
  if (!battles.length) return null;
  const latest = battles[battles.length - 1].start_time.slice(0, 10);
  const earliest = battles[0].start_time.slice(0, 10);
  const inWindow = (b: Battle, days: number) => b.start_time.slice(0, 10) >= dayOffset(latest, days);

  // ---- 系列第一局禁选 ----
  const g1Stat = (days: number) => {
    const games = battles.filter((b) => b.battle_seq === 1 && inWindow(b, days));
    const m = new Map<number, { pick: number; ban: number }>();
    for (const b of games)
      for (const x of b.bp) {
        if (!(x.hero > 0)) continue;
        const e = m.get(x.hero) ?? { pick: 0, ban: 0 };
        if (x.pick) e.pick++;
        else e.ban++;
        m.set(x.hero, e);
      }
    return { games: games.length, m };
  };
  const g1Recent = g1Stat(HEAT_DAYS);
  const g1Year = g1Stat(PAIR_DAYS);

  // ---- 分路分布 ----
  const laneCount = (bs: Battle[]) => {
    const m = new Map<number, number[]>();
    for (const b of bs)
      for (const p of b.players) {
        const lane = POS_TO_LANE[p.pos_desc];
        if (!lane || !known.has(p.hero)) continue;
        const arr = m.get(p.hero) ?? [0, 0, 0, 0, 0];
        arr[lane - 1]++;
        m.set(p.hero, arr);
      }
    return m;
  };
  const lanesRecent = laneCount(battles.filter((b) => inWindow(b, LANE_DAYS)));
  const lanesAll = laneCount(battles);

  // ---- 同队共现 ----
  const pairBattles = battles.filter((b) => inWindow(b, PAIR_DAYS) && !isBlindDecider(b));
  const teamPicks: number[][] = [];
  const teamDates: string[] = [];
  for (const b of pairBattles)
    for (const camp of [1, 2] as const) {
      const picks = b.players.filter((p) => p.camp === camp && known.has(p.hero)).map((p) => p.hero).sort((x, y) => x - y);
      if (picks.length === 5) {
        teamPicks.push(picks);
        teamDates.push(b.start_time.slice(0, 10));
      }
    }
  const N = teamPicks.length;
  const resp = computeResp(pairBattles, known);
  const lanesYear = laneCount(pairBattles);
  const single = new Map<number, number>();
  const pair = new Map<string, number>();
  type Span = { n: number; first: string; last: string };
  const trio = new Map<string, Span>();
  const lineup = new Map<string, Span>();
  const bump = (m: Map<string, Span>, k: string, d: string) => {
    const e = m.get(k);
    if (!e) m.set(k, { n: 1, first: d, last: d });
    else {
      e.n++;
      if (d < e.first) e.first = d;
      if (d > e.last) e.last = d;
    }
  };
  teamPicks.forEach((t, idx) => {
    const d = teamDates[idx];
    for (const a of t) single.set(a, (single.get(a) ?? 0) + 1);
    for (let i = 0; i < 5; i++)
      for (let j = i + 1; j < 5; j++) {
        pair.set(`${t[i]}-${t[j]}`, (pair.get(`${t[i]}-${t[j]}`) ?? 0) + 1);
        for (let k = j + 1; k < 5; k++) bump(trio, `${t[i]}-${t[j]}-${t[k]}`, d);
      }
    bump(lineup, t.join('-'), d);
  });
  const pairs = [...pair.entries()]
    .map(([k, n]) => {
      const [a, b] = k.split('-').map(Number);
      const expected = (single.get(a)! * single.get(b)!) / N;
      return { a, b, n, expected: +expected.toFixed(1), lift: +(n / expected).toFixed(2) };
    })
    .filter((p) => p.n >= PAIR_MIN_N)
    .sort((x, y) => y.lift - x.lift);

  const generatedAt = new Date().toISOString();
  const stats: KplStats = {
    generatedAt,
    source: '腾讯官方赛事数据中心（KPL、世冠、挑战者杯等职业赛事）',
    coverage: { battlesFetched: totalFetched, battlesUsable: battles.length, from: earliest, to: latest },
    heat: {
      recent: { windowDays: HEAT_DAYS, from: dayOffset(latest, HEAT_DAYS), to: latest, games: g1Recent.games },
      year: { windowDays: PAIR_DAYS, from: dayOffset(latest, PAIR_DAYS), to: latest, games: g1Year.games },
    },
    lanes: { windowDays: LANE_DAYS },
    pairs: { windowDays: PAIR_DAYS, from: dayOffset(latest, PAIR_DAYS), to: latest, teamGames: N, minN: PAIR_MIN_N, list: pairs },
    resp: { windowDays: PAIR_DAYS, from: dayOffset(latest, PAIR_DAYS), to: latest, ...resp },
    heroes: Object.fromEntries(
      heroes
        .filter((h) => lanesAll.has(h.id) || g1Year.m.has(h.id))
        .map((h) => {
          const recent = lanesRecent.get(h.id);
          const useRecent = !!recent && recent.reduce((s, x) => s + x, 0) >= 10;
          return [
            h.id,
            {
              lanes: (useRecent ? recent : lanesAll.get(h.id)) ?? [0, 0, 0, 0, 0],
              lanesScope: useRecent ? ('recent' as const) : ('all' as const),
              g1Recent: g1Recent.m.get(h.id) ?? { pick: 0, ban: 0 },
              g1Year: g1Year.m.get(h.id) ?? { pick: 0, ban: 0 },
              teamGames: single.get(h.id) ?? 0,
              lanesYear: lanesYear.get(h.id) ?? [0, 0, 0, 0, 0],
            },
          ];
        }),
    ),
  };

  const toList = (m: Map<string, Span>, min: number) =>
    [...m.entries()]
      .filter(([, v]) => v.n >= min)
      .map(([k, v]) => ({ heroes: k.split('-').map(Number), ...v }))
      .sort((x, y) => y.n - x.n);
  const comps: KplComps = {
    generatedAt,
    windowDays: PAIR_DAYS,
    from: stats.pairs.from,
    to: latest,
    teamGames: N,
    trios: toList(trio, TRIO_MIN_N).slice(0, 300),
    lineups: toList(lineup, LINEUP_MIN_N).slice(0, 200),
  };
  return { stats, comps };
}
