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

/**
 * 候选英雄对本方阵容缺口的补足程度。
 * 越接近选完，缺口的权重越大；阵容还很空时只给很小的倾向。
 */
export function needsScore(candidate: HeroData, allies: HeroData[]): NeedNote[] {
  const notes: NeedNote[] = [];
  // 前两手还谈不上阵容缺口
  if (allies.length < 2) return notes;
  const f = teamFeatures(allies);
  const remainingAfter = 5 - allies.length - 1; // 选了候选之后还剩几个位置
  const urgency = remainingAfter <= 0 ? 1 : remainingAfter === 1 ? 0.8 : remainingAfter === 2 ? 0.55 : 0.3;
  const dt = damageType(candidate);

  // 伤害类型
  if (allies.length >= 2) {
    if (f.magic === 0 && f.mixed === 0) {
      if (dt !== 'physical') notes.push({ delta: 6 * urgency, text: '本方目前全是物理伤害，它能补法术伤害' });
      else if (allies.length >= 3) notes.push({ delta: -5 * urgency, text: '本方已全是物理伤害，再选物理容易被针对出装' });
    } else if (f.physical === 0 && f.mixed === 0) {
      if (dt !== 'magic') notes.push({ delta: 6 * urgency, text: '本方目前全是法术伤害，它能补物理伤害' });
      else if (allies.length >= 3) notes.push({ delta: -5 * urgency, text: '本方已全是法术伤害，再选法术容易被针对出装' });
    }
  }

  // 前排
  if (f.frontline === 0) {
    if (isFrontline(candidate)) notes.push({ delta: 7 * urgency, text: '本方还没有坦克，它能承担前排' });
    else if (remainingAfter === 0) notes.push({ delta: -6, text: '选它之后本方没有坦克前排' });
  }

  if (profileUsable(candidate)) {
    // 硬控
    if (f.hardCC + f.unknown < 2 && hasHardCC(candidate)) notes.push({ delta: (f.hardCC === 0 ? 5 : 3) * urgency, text: f.hardCC === 0 ? '本方还没有硬控，它能补控制' : '本方硬控偏少，它能补控制' });
    // 开团
    if (f.engage === 0 && f.unknown === 0 && isEngager(candidate) && allies.length >= 2) notes.push({ delta: 3 * urgency, text: '本方缺少先手开团，它有位移加范围硬控' });
    // 清线
    if (f.waveClear === 0 && f.unknown === 0 && hasWaveClear(candidate) && allies.length >= 2) notes.push({ delta: 2 * urgency, text: '本方缺少范围伤害清线，它有多个范围伤害技能' });
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
