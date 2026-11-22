// KPL聚合统计的计算。只计算受“系列赛内全局BP”偏差影响较小的统计量，不计算任何胜率：
//   - 系列第一局禁选次数：每个系列赛第一局不受全局BP影响
//   - 分路分布：选手实际分路
//   - 同队共现提升度：lift = 实际同队次数 / 独立假设下的期望次数（样本≥30才输出）
//   - 常见三人组合与完整阵容的出现次数
// asOf 用于回测：只使用该日期之前的对局，重建“当时能看到的数据”。
import type { KplComps, KplStats, OfficialHero } from '../../src/types.ts';
import { POS_TO_LANE, isBlindDecider, type Battle } from './kpl.ts';

export const HEAT_DAYS = 150; // 第一局禁选的近期窗口
export const LANE_DAYS = 500; // 分路分布窗口
export const PAIR_DAYS = 365; // 共现窗口
export const PAIR_MIN_N = 30;
export const TRIO_MIN_N = 12;
export const LINEUP_MIN_N = 3;

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
