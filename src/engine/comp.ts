// 阵容特征与战术体系分析。全部由官方数据和已核实的机制标签计算，不含主观评分。
import { HERO_TYPE_NAME, type Archetype, type Cond, type HeroData, type Lane } from '../types.ts';
import { evalCond, hasTag, profileUsable, tagSkillCount, verifiedTags } from './rules.ts';
import type { RelationIndex } from './relations.ts';
import { primaryLane } from './lanes.ts';

export type DamageType = 'physical' | 'magic' | 'mixed';

/** 主要伤害类型：按技能原文中“物理伤害/法术伤害”的出现次数判断；原文没有时按官方职业（法师为法术，其余为物理）。 */
export function damageType(h: HeroData): DamageType {
  const { phys, magic } = h.dmg;
  const total = phys + magic;
  if (total === 0) return h.heroType === 2 ? 'magic' : 'physical';
  const r = phys / total;
  return r >= 0.65 ? 'physical' : r <= 0.35 ? 'magic' : 'mixed';
}

/** 前排：官方主职业或副职业为坦克 */
export const isFrontline = (h: HeroData) => h.heroType === 3 || h.heroType2 === 3;
export const hasHardCC = (h: HeroData) => hasTag(h, 'cc_hard');
export const hasAoeCC = (h: HeroData) => hasTag(h, 'cc_hard_aoe');
export const isEngager = (h: HeroData) => hasAoeCC(h) && (hasTag(h, 'dash') || hasTag(h, 'global'));
export const isProtector = (h: HeroData) => tagSkillCount(h, ['heal_ally', 'shield_ally', 'ally_cc_immune']) > 0;
export const hasWaveClear = (h: HeroData) => tagSkillCount(h, ['aoe_damage']) >= 2;

export interface TeamFeatures {
  size: number;
  physical: number;
  magic: number;
  mixed: number;
  frontline: number;
  hardCC: number;
  aoeCC: number;
  engage: number;
  protect: number;
  waveClear: number;
  /** 档案不可用（未盲审或待复核）的英雄数；这些英雄的机制特征按“未知”处理 */
  unknown: number;
}

export function teamFeatures(team: HeroData[]): TeamFeatures {
  const f: TeamFeatures = { size: team.length, physical: 0, magic: 0, mixed: 0, frontline: 0, hardCC: 0, aoeCC: 0, engage: 0, protect: 0, waveClear: 0, unknown: 0 };
  for (const h of team) {
    f[damageType(h)]++;
    if (isFrontline(h)) f.frontline++;
    if (!profileUsable(h)) {
      f.unknown++;
      continue;
    }
    if (hasHardCC(h)) f.hardCC++;
    if (hasAoeCC(h)) f.aoeCC++;
    if (isEngager(h)) f.engage++;
    if (isProtector(h)) f.protect++;
    if (hasWaveClear(h)) f.waveClear++;
  }
  return f;
}

export interface NeedNote {
  delta: number;
  text: string;
}

// ---------- 阵容底线 ----------
//
// 职业队的阵容几乎都满足下面这些条件（近一年3430个阵容里的占比见 data/derived/kpl/floors.json，界面上会显示）。
// 但职业队是“按位置选常用英雄”自然满足的：把各位置的常用英雄随机拼在一起，满足的比例几乎一样。
// 所以从职业赛选人里学不出“缺什么补什么”的力度——职业赛里基本不出现缺口。
// 路人局队友可能选出职业赛里没有的缺口，因此这一项不靠模型学，直接按底线给分：
//   must   —— 职业阵容99%以上满足，缺了就是明显的硬伤；
//   should —— 职业阵容90%以上满足，最好有。

/** 坦克或战士：能站在前面的英雄。职业阵容不一定有官方职业为坦克的英雄（约一成没有），但一定有坦克或战士。 */
export const isBruiser = (h: HeroData) => isFrontline(h) || h.heroType === 1;

export interface CompFloor {
  key: string;
  /** 这一类英雄叫什么 */
  label: string;
  test: (h: HeroData) => boolean;
  /** 是否依赖机制档案 */
  needsProfile: boolean;
  /** 至少要有几个：must 为硬性底线（0表示没有），should 为最好达到的数量 */
  must: number;
  should: number;
}

export const COMP_FLOORS: CompFloor[] = [
  { key: 'hardCC', label: '硬控', test: hasHardCC, needsProfile: true, must: 1, should: 2 },
  { key: 'bruiser', label: '坦克或战士', test: isBruiser, needsProfile: false, must: 1, should: 2 },
  { key: 'magic', label: '法术伤害', test: (h) => damageType(h) !== 'physical', needsProfile: false, must: 1, should: 1 },
  { key: 'physical', label: '物理伤害', test: (h) => damageType(h) !== 'magic', needsProfile: false, must: 1, should: 1 },
  { key: 'aoeCC', label: '范围硬控', test: hasAoeCC, needsProfile: true, must: 0, should: 1 },
  { key: 'engage', label: '先手开团', test: isEngager, needsProfile: true, must: 0, should: 1 },
  { key: 'waveClear', label: '清线', test: hasWaveClear, needsProfile: true, must: 0, should: 2 },
];

/** 底线的分值：缺硬性底线的最后一手，补上与不补相差 2×must 分。
 *  “最好有”一档定为 1.25：回测里这一档取 0 / 1.25 / 2.5 时，2026年测试集 Top10 命中率为 79.1% / 78.7% / 78.0%
 *  （硬性底线本身只让命中率下降约0.2个百分点），取中间值，让它只在分数接近的候选之间起作用。
 *  换分值做诊断：tsx scripts/backtest.ts --floor-points=6,2.5 */
export const FLOOR_POINTS = { must: 6, should: 1.25 };
/** 从第几个队友之后开始考虑（前两手还谈不上阵容缺口） */
const FLOOR_FROM = 2;

export interface TeamGap {
  floor: CompFloor;
  have: number;
  /** 还差几个才到硬性底线 / 才到“最好有”的数量 */
  needMust: number;
  needShould: number;
}

/** 当前阵容还没达到的底线。档案不可用的英雄让依赖档案的项目无法判断，这些项目不列出。 */
export function teamGaps(team: HeroData[]): TeamGap[] {
  const unknown = team.some((h) => !profileUsable(h));
  const out: TeamGap[] = [];
  for (const floor of COMP_FLOORS) {
    if (floor.needsProfile && unknown) continue;
    const have = team.filter(floor.test).length;
    const needMust = Math.max(0, floor.must - have);
    const needShould = Math.max(0, floor.should - have);
    if (needMust || needShould) out.push({ floor, have, needMust, needShould });
  }
  return out;
}

const countText = (have: number, label: string) => (have === 0 ? `没有${label}` : `只有${have}个${label}`);

/**
 * 候选英雄对本方阵容底线的影响（分值为最终分值，不再缩放）。
 * 能补缺口的加分，越接近选完加得越多；选了它之后底线已经不可能达到的扣分。
 */
export function needsScore(candidate: HeroData, allies: HeroData[]): NeedNote[] {
  const notes: NeedNote[] = [];
  if (allies.length < FLOOR_FROM || allies.length >= 5) return notes;
  const remainingAfter = 5 - allies.length - 1; // 选了候选之后还剩几个位置
  const candKnown = profileUsable(candidate);
  for (const g of teamGaps(allies)) {
    const f = g.floor;
    if (f.needsProfile && !candKnown) continue;
    const tier = g.needMust > 0 ? 'must' : 'should';
    const need = tier === 'must' ? g.needMust : g.needShould;
    const points = FLOOR_POINTS[tier];
    if (f.test(candidate)) {
      // 剩下的位置里有多大比例必须用来补这个缺口
      const urgency = Math.min(1, need / (remainingAfter + 1));
      notes.push({ delta: points * urgency, text: `本方${countText(g.have, f.label)}，它能补上` });
    } else if (need > remainingAfter) {
      const after = remainingAfter === 0 ? '选它之后本方' : `选它之后，剩下${remainingAfter}个位置也凑不够：本方`;
      notes.push({ delta: -points, text: `${after}${countText(g.have, f.label)}${tier === 'should' ? `（最好有${f.should}个）` : ''}` });
    }
  }
  return notes.map((n) => ({ ...n, delta: +n.delta.toFixed(1) }));
}

// ---------- 战术体系 ----------

const typeName = (t: number) => HERO_TYPE_NAME[t] ?? '';

export interface ArchetypeMatch {
  archetype: Archetype;
  /** 触发该体系的核心英雄 */
  cores: HeroData[];
  detail: { label: string; heroes: HeroData[]; count: number }[];
}

export function matchArchetypes(team: HeroData[], archetypes: Archetype[], tagName: (id: string) => string): ArchetypeMatch[] {
  const out: ArchetypeMatch[] = [];
  for (const a of archetypes) {
    const detail = a.needs.map((n) => ({
      label: n.label,
      count: n.count,
      heroes: team.filter((h) => evalCond(h, n.cond, typeName, tagName).ok),
    }));
    if (detail.every((d) => d.heroes.length >= d.count)) {
      const cores = [...new Set(detail.flatMap((d) => d.heroes))];
      out.push({ archetype: a, cores, detail });
    }
  }
  return out;
}

export const heroesMatching = (pool: HeroData[], cond: Cond, tagName: (id: string) => string) =>
  pool.filter((h) => evalCond(h, cond, typeName, tagName).ok);

export interface TeamThreat {
  hero: HeroData;
  weight: number;
  targets: HeroData[];
}

/** 对这套阵容克制权重最高的英雄（可用于“这套阵容怕谁”和Ban建议） */
export function teamThreats(team: HeroData[], pool: HeroData[], rel: RelationIndex, limit = 6): TeamThreat[] {
  const ids = new Set(team.map((h) => h.id));
  return pool
    .filter((h) => !ids.has(h.id))
    .map((h) => {
      const targets = team.filter((t) => rel.net(h.id, t.id) > 0);
      return { hero: h, weight: +targets.reduce((s, t) => s + rel.net(h.id, t.id), 0).toFixed(2), targets };
    })
    .filter((t) => t.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
}

/** 替代英雄：同一主分路中，已核实机制标签集合最相似的英雄 */
export function substitutes(hero: HeroData, pool: HeroData[], lane?: Lane, limit = 3): { hero: HeroData; similarity: number; shared: string[] }[] {
  const target = lane ?? primaryLane(hero);
  const mine = new Set(verifiedTags(hero).map((t) => t.tag));
  if (!mine.size) return [];
  return pool
    .filter((h) => h.id !== hero.id && !h.isLimited && h.lanes[target - 1] >= 0.5 && profileUsable(h) && !(h.groupId && h.groupId === hero.groupId))
    .map((h) => {
      const theirs = new Set(verifiedTags(h).map((t) => t.tag));
      const shared = [...mine].filter((t) => theirs.has(t));
      const union = new Set([...mine, ...theirs]).size;
      // 伤害类型不同的替代会改变阵容结构，降低相似度
      const penalty = damageType(h) === damageType(hero) ? 1 : 0.8;
      return { hero: h, similarity: +((shared.length / union) * penalty).toFixed(2), shared };
    })
    .filter((x) => x.similarity >= 0.3)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
