// 阵容分析的计算部分（纯函数），供阵容分析组件和阵容对比共用。
// 全部基于 engine/comp.ts、engine/lanes.ts 的结果，不引入新的评分。
import { LANE_NAME, type Archetype, type HeroData, type Lane } from '../../types.ts';
import { assignLanes } from '../../engine/lanes.ts';
import { profileUsable } from '../../engine/rules.ts';
import { damageType, hasAoeCC, hasHardCC, hasWaveClear, isEngager, isFrontline, isProtector, matchArchetypes, teamFeatures, type ArchetypeMatch, type DamageType, type TeamFeatures } from '../../engine/comp.ts';

export type FeatureKey = 'frontline' | 'hardCC' | 'aoeCC' | 'engage' | 'protect' | 'waveClear';

export interface FeatureDef {
  key: FeatureKey;
  label: string;
  test: (h: HeroData) => boolean;
  /** 是否依赖机制档案（档案不可用的英雄按未知处理） */
  needsProfile: boolean;
  how: (tagName: (id: string) => string) => string;
}

const q = (s: string) => `“${s}”`;

export const FEATURES: FeatureDef[] = [
  { key: 'frontline', label: '前排', test: isFrontline, needsProfile: false, how: () => '官方主职业或副职业为坦克' },
  { key: 'hardCC', label: '硬控', test: hasHardCC, needsProfile: true, how: (t) => `技能原文中有已核实的${q(t('cc_hard'))}标签` },
  { key: 'aoeCC', label: '范围硬控', test: hasAoeCC, needsProfile: true, how: (t) => `技能原文中有已核实的${q(t('cc_hard_aoe'))}标签` },
  {
    key: 'engage',
    label: '先手开团',
    test: isEngager,
    needsProfile: true,
    how: (t) => `同时有已核实的${q(t('cc_hard_aoe'))}标签，以及${q(t('dash'))}或${q(t('global'))}标签`,
  },
  {
    key: 'protect',
    label: '保护',
    test: isProtector,
    needsProfile: true,
    how: (t) => `有已核实的${q(t('heal_ally'))}、${q(t('shield_ally'))}或${q(t('ally_cc_immune'))}标签`,
  },
  { key: 'waveClear', label: '清线', test: hasWaveClear, needsProfile: true, how: (t) => `至少两个技能有已核实的${q(t('aoe_damage'))}标签` },
];

export const DAMAGE_NAME: Record<DamageType, string> = { physical: '物理', magic: '法术', mixed: '混合' };
export const DAMAGE_HOW = '按技能原文中“物理伤害”“法术伤害”的出现次数：物理占比≥65%记为物理，≤35%记为法术，其间记为混合；原文没写伤害类型时按官方职业（法师记法术，其余记物理）';

export const PROFILE_STATE = (h: HeroData): string | null => {
  if (!h.profile) return '没有机制档案';
  if (h.profile.status === 'needs_review') return '技能原文已变更，档案待复核';
  if (h.profile.status !== 'verified') return '档案尚未盲审';
  return null;
};

export interface LaneRow {
  hero: HeroData;
  lane: Lane;
  fit: number;
}

export interface Gap {
  tone: 'bad' | 'warn';
  text: string;
}

export interface CompSummary {
  heroes: HeroData[];
  lanes: LaneRow[];
  openLanes: Lane[];
  lowFit: LaneRow[];
  features: TeamFeatures;
  damage: Record<DamageType, HeroData[]>;
  /** 每项特征由谁满足 */
  byFeature: Record<FeatureKey, HeroData[]>;
  unknownHeroes: HeroData[];
  gaps: Gap[];
  /** 计数为0、但不算明显缺口的项 */
  missingOther: string[];
  matches: ArchetypeMatch[];
}

export const LOW_FIT = 0.5;

export function summarize(heroes: HeroData[], archetypes: Archetype[], tagName: (id: string) => string): CompSummary {
  const la = assignLanes(heroes.map((hero) => ({ hero })));
  const lanes: LaneRow[] = heroes.map((hero, i) => ({ hero, lane: la.lanes[i], fit: la.fits[i] ?? 0 }));
  const features = teamFeatures(heroes);
  const damage: Record<DamageType, HeroData[]> = { physical: [], magic: [], mixed: [] };
  for (const h of heroes) damage[damageType(h)].push(h);
  const unknownHeroes = heroes.filter((h) => !profileUsable(h));
  const byFeature = {} as Record<FeatureKey, HeroData[]>;
  for (const f of FEATURES) byFeature[f.key] = heroes.filter((h) => (f.needsProfile ? profileUsable(h) : true) && f.test(h));

  const gaps: Gap[] = [];
  const missingOther: string[] = [];
  const partial = heroes.length < 5 ? '（阵容未满5人）' : '';
  if (heroes.length >= 3) {
    if (features.frontline === 0) gaps.push({ tone: 'bad', text: `没有前排：阵容里没有官方职业为坦克的英雄${partial}` });
    if (features.magic === 0 && features.mixed === 0) gaps.push({ tone: 'bad', text: `全是物理伤害：没有法术或混合伤害的英雄${partial}` });
    else if (features.physical === 0 && features.mixed === 0) gaps.push({ tone: 'bad', text: `全是法术伤害：没有物理或混合伤害的英雄${partial}` });
    if (features.hardCC === 0) {
      if (features.unknown === 0) gaps.push({ tone: 'bad', text: `没有硬控：没有英雄带已核实的硬控标签${partial}` });
      else gaps.push({ tone: 'warn', text: `已核实档案中没有硬控；另有${features.unknown}个英雄档案不可用，无法判断` });
    }
    for (const f of FEATURES) {
      if (f.key === 'frontline' || f.key === 'hardCC') continue;
      if (byFeature[f.key].length === 0) missingOther.push(f.label);
    }
  }

  return {
    heroes,
    lanes,
    openLanes: la.open,
    lowFit: lanes.filter((r) => r.fit < LOW_FIT),
    features,
    damage,
    byFeature,
    unknownHeroes,
    gaps,
    missingOther,
    matches: matchArchetypes(heroes, archetypes, tagName),
  };
}

export const laneFitText = (r: LaneRow) =>
  r.fit <= 0 ? `${r.hero.name}被分到${LANE_NAME[r.lane]}，但这不是它的常规分路（适配度0）` : `${r.hero.name}在${LANE_NAME[r.lane]}的适配度为${r.fit.toFixed(2)}，低于常规分路标准${LOW_FIT}`;
