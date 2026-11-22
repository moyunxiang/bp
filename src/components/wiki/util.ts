// 英雄百科页面共用的小工具。
import { LANES, type Bundle, type HeroData, type Lane } from '../../types.ts';

/** 常规分路：适配权重 >= 0.5 */
export const regularLanes = (h: HeroData): Lane[] => LANES.filter((l) => h.lanes[l - 1] >= 0.5);

/** 偶尔可走的分路：0 < 权重 < 0.5 */
export const minorLanes = (h: HeroData): Lane[] => LANES.filter((l) => h.lanes[l - 1] > 0 && h.lanes[l - 1] < 0.5);

export interface KplHeat {
  scope: 'recent' | 'year';
  games: number;
  from: string;
  to: string;
  pick: number;
  ban: number;
}

/** 职业赛系列赛第一局的被选/被禁次数：优先近期窗口，局数不足20时改用一年窗口 */
export function kplHeat(bundle: Bundle, h: HeroData): KplHeat | null {
  const heat = bundle.kpl?.heat;
  if (!heat || !h.kpl) return null;
  const scope = heat.recent.games >= 20 ? 'recent' : 'year';
  const w = heat[scope];
  const s = scope === 'recent' ? h.kpl.g1Recent : h.kpl.g1Year;
  return { scope, games: w.games, from: w.from, to: w.to, pick: s.pick, ban: s.ban };
}

/** 技能槽位 → 技能名 */
export const skillName = (h: HeroData, slot: string) => h.skills.find((s) => s.slot === slot)?.name ?? null;

/** 同组（同一英雄的不同形态）的其他英雄 */
export const groupSiblings = (heroes: HeroData[], h: HeroData) => (h.groupId ? heroes.filter((x) => x.groupId === h.groupId && x.id !== h.id) : []);

export const RATING_LABEL: [keyof HeroData['ratings'], string][] = [
  ['survive', '生存能力'],
  ['attack', '攻击伤害'],
  ['skill', '技能效果'],
  ['difficulty', '上手难度'],
];

/** 官方冷却/消耗为 "0" 或空时显示为 “—” */
export const officialValue = (v: string) => (!v || v.trim() === '0' ? '—' : v);
