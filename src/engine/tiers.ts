// 各分路梯度：完全由职业赛禁选数据计算，不含任何主观强度判断，也不是路人局强度。
//   出场率 = （第一局里在该位置被选的次数 + 第一局被禁次数 × 该英雄打这个位置的比例）÷ 第一局总局数
//   只用每个系列赛的第一局：之后几局受“全局BP”（本队用过的英雄不能再用）影响，不能反映优先级。
import { LANES, type Bundle, type HeroData, type Lane } from '../types.ts';

export interface TierRow {
  hero: HeroData;
  lane: Lane;
  /** 0–1 */
  presence: number;
  /** 第一局里在该位置被选的次数 */
  picks: number;
  /** 第一局被禁次数（全部位置合计） */
  bans: number;
  /** 被禁次数里按位置比例分给这个位置的部分 */
  bansHere: number;
  /** 近期窗口（60天）全部对局里在该位置的出场次数 */
  recent: number;
  tier: number;
}

/** T0–T3 的出场率下限；低于最后一档不列出 */
export const TIER_MIN = [0.5, 0.3, 0.15, 0.05];
export const TIER_NAME = ['T0', 'T1', 'T2', 'T3'];

export function laneTiers(bundle: Bundle): { games: number; rows: Record<Lane, TierRow[]> } | null {
  const games = bundle.kpl?.heat.recent.games ?? 0;
  if (!bundle.kpl || games < 20) return null;
  const rows = Object.fromEntries(LANES.map((l) => [l, [] as TierRow[]])) as Record<Lane, TierRow[]>;
  for (const hero of bundle.heroes) {
    const k = hero.kpl;
    if (!k?.g1LaneRecent || hero.isLimited) continue;
    const year = k.lanesYear ?? k.lanes;
    const total = year.reduce((s, x) => s + x, 0);
    for (const lane of LANES) {
      const share = total ? year[lane - 1] / total : 0;
      const picks = k.g1LaneRecent[lane - 1];
      const bansHere = k.g1Recent.ban * share;
      const presence = Math.min(1, (picks + bansHere) / games);
      const tier = TIER_MIN.findIndex((m) => presence >= m);
      if (tier < 0) continue;
      rows[lane].push({ hero, lane, presence, picks, bans: k.g1Recent.ban, bansHere, recent: k.lanesShort?.[lane - 1] ?? 0, tier });
    }
  }
  for (const lane of LANES) rows[lane].sort((a, b) => b.presence - a.presence || b.picks - a.picks || a.hero.id - b.hero.id);
  return { games, rows };
}
