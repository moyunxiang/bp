// 局内打法：根据双方阵容给出“我方怎么打、对面的突破口、要防的点、出装针对、分路对位”。
// 文字来自人工审定的打法表（data/curated/playbook.json）和体系定义，由双方阵容的官方职业、已核实机制标签触发；
// 集火目标与分路对位由关系库的净克制权重计算。全部是通用战术说明或证据计分，不是胜率。
import { HERO_TYPE_NAME, LANES, type Archetype, type Bundle, type Cond, type HeroData, type Lane, type PlayClause, type PlayEntry, type PlayFeature, type PlaySection, type ProfileTag } from '../types.ts';
import { damageType, hasAoeCC, hasHardCC, hasWaveClear, isEngager, isFrontline, isProtector, matchArchetypes, type ArchetypeMatch, type DamageType } from './comp.ts';
import { assignLanes } from './lanes.ts';
import { sameGroup, type Relation, type RelationIndex } from './relations.ts';
import { evalCond, profileUsable, verifiedTags } from './rules.ts';

const typeName = (t: number) => HERO_TYPE_NAME[t] ?? '';
const DAMAGE_NAME: Record<DamageType, string> = { physical: '物理', magic: '法术', mixed: '混合' };

/** 命中某一句条件的英雄，以及支撑它的标签（带原文）和文字说明 */
export interface PlayHero {
  hero: HeroData;
  tags: ProfileTag[];
  notes: string[];
}

interface FeatureDef {
  /** 是否依赖机制档案（档案不可用的英雄无法判断） */
  needsProfile: boolean;
  test: (h: HeroData) => boolean;
  tags: string[];
  note?: (h: HeroData) => string;
}

const dmg = (k: DamageType): FeatureDef => ({ needsProfile: false, test: (h) => damageType(h) === k, tags: [], note: () => `主要伤害类型：${DAMAGE_NAME[k]}` });

const FEATURE: Record<PlayFeature, FeatureDef> = {
  frontline: { needsProfile: false, test: isFrontline, tags: [], note: () => '官方职业：坦克' },
  hardCC: { needsProfile: true, test: hasHardCC, tags: ['cc_hard'] },
  aoeCC: { needsProfile: true, test: hasAoeCC, tags: ['cc_hard_aoe'] },
  engage: { needsProfile: true, test: isEngager, tags: ['cc_hard_aoe', 'dash', 'global'] },
  protect: { needsProfile: true, test: isProtector, tags: ['heal_ally', 'shield_ally', 'ally_cc_immune'] },
  waveClear: { needsProfile: true, test: hasWaveClear, tags: ['aoe_damage'] },
  physical: dmg('physical'),
  magic: dmg('magic'),
  mixed: dmg('mixed'),
};

export const PLAY_FEATURES = Object.keys(FEATURE) as PlayFeature[];

const condNeedsProfile = (c: Cond): boolean => !!(c.tags?.length || c.none?.length || c.all?.some(condNeedsProfile));
export const clauseNeedsProfile = (c: PlayClause) => (c.feature ? FEATURE[c.feature].needsProfile : false) || (c.cond ? condNeedsProfile(c.cond) : false);

function matchClause(c: PlayClause, team: HeroData[], tagName: (id: string) => string): PlayHero[] {
  const out: PlayHero[] = [];
  for (const hero of team) {
    const tags: ProfileTag[] = [];
    const notes: string[] = [];
    if (c.feature) {
      const f = FEATURE[c.feature];
      if (f.needsProfile && !profileUsable(hero)) continue;
      if (!f.test(hero)) continue;
      tags.push(...verifiedTags(hero, f.tags));
      if (f.note) notes.push(f.note(hero));
    }
    if (c.cond) {
      const r = evalCond(hero, c.cond, typeName, tagName);
      if (!r.ok) continue;
      tags.push(...r.tags);
      notes.push(...r.notes);
    }
    out.push({ hero, tags, notes });
  }
  return out;
}

export interface PlayItem {
  id: string;
  section: PlaySection;
  title: string;
  /** 已把英雄名、装备名代入的文字 */
  text: string;
  basis: string;
  ally: PlayHero[];
  enemy: PlayHero[];
  /** 条目里点名的装备（官方装备说明中含有 entry.items 关键词的装备） */
  items: { id: number; name: string; desc: string }[];
  itemsKeyword?: string;
}

export interface FocusRow {
  /** 被针对的英雄 */
  hero: HeroData;
  /** 对它有净克制的英雄及净权重 */
  by: { hero: HeroData; net: number }[];
  total: number;
}

export interface LaneMatchup {
  lane: Lane;
  ally: HeroData | null;
  enemy: HeroData | null;
  /** 我方对对方的净克制权重：正数我方占优，负数对方占优，0为暂无结论或抵消 */
  net: number;
  /** 我方克制对方 / 对方克制我方的关系（可能同时存在） */
  mine?: Relation;
  theirs?: Relation;
}

export interface Playbook {
  allyArchetypes: ArchetypeMatch[];
  enemyArchetypes: ArchetypeMatch[];
  plan: PlayItem[];
  openings: PlayItem[];
  dangers: PlayItem[];
  builds: PlayItem[];
  /** 对面的谁最好打：我方对它的净克制权重合计最高的几位 */
  focus: FocusRow[];
  /** 对面的谁威胁最大：它对我方的净克制权重合计最高的几位 */
  threats: FocusRow[];
  lanes: LaneMatchup[];
  /** “没有/缺少”类的判断需要选满5人、档案都可用；不满足时这类条目不出现 */
  complete: { ally: boolean; enemy: boolean };
}

export interface PlayContext {
  bundle: Pick<Bundle, 'playbook' | 'archetypes' | 'equipment'>;
  rel: RelationIndex;
  tagName: (id: string) => string;
}

export interface PlayOptions {
  /** 与 ally / enemy 同序的手动分路锁定 */
  allyLocks?: (Lane | null)[];
  enemyLocks?: (Lane | null)[];
}

const fill = (text: string, vars: Record<string, string>) => text.replace(/\{([a-z0-9_]+)\}/gi, (m, k: string) => vars[k] ?? m);

/** 求一条打法条目是否触发；触发时返回代入后的结果 */
export function evalEntry(e: PlayEntry, ally: HeroData[], enemy: HeroData[], ctx: PlayContext): PlayItem | null {
  const vars: Record<string, string> = {};
  const hit: Record<'ally' | 'enemy', Map<number, PlayHero>> = { ally: new Map(), enemy: new Map() };
  for (const c of e.when) {
    const team = c.side === 'ally' ? ally : enemy;
    if (c.max != null) {
      // 否定判断：必须选满，且涉及机制标签时全队档案都可用
      if (team.length < 5) return null;
      if (clauseNeedsProfile(c) && team.some((h) => !profileUsable(h))) return null;
    }
    const matched = matchClause(c, team, ctx.tagName);
    const min = c.min ?? (c.max != null ? 0 : 1);
    if (matched.length < min || (c.max != null && matched.length > c.max)) return null;
    if (c.as) vars[c.as] = matched.map((m) => m.hero.name).join('、');
    for (const m of matched) {
      const prev = hit[c.side].get(m.hero.id);
      if (prev) {
        for (const t of m.tags) if (!prev.tags.includes(t)) prev.tags.push(t);
        for (const n of m.notes) if (!prev.notes.includes(n)) prev.notes.push(n);
      } else hit[c.side].set(m.hero.id, { hero: m.hero, tags: [...m.tags], notes: [...m.notes] });
    }
  }
  const items = e.items ? ctx.bundle.equipment.items.filter((i) => i.desc.includes(e.items!)).map((i) => ({ id: i.id, name: i.name, desc: i.desc })) : [];
  if (e.items && !items.length) return null;
  vars.items = items.map((i) => i.name).join('、');
  return { id: e.id, section: e.section, title: e.title, text: fill(e.text, vars), basis: e.basis, ally: [...hit.ally.values()], enemy: [...hit.enemy.values()], items, itemsKeyword: e.items };
}

/** from 一方对 to 一方：to 中每个英雄被 from 净克制的情况，按合计降序 */
function focusRows(from: HeroData[], to: HeroData[], rel: RelationIndex, limit: number): FocusRow[] {
  return to
    .map((hero) => {
      const by = from
        .filter((a) => a.id !== hero.id && !sameGroup(a, hero))
        .map((a) => ({ hero: a, net: +rel.net(a.id, hero.id).toFixed(2) }))
        .filter((x) => x.net > 0)
        .sort((x, y) => y.net - x.net);
      return { hero, by, total: +by.reduce((s, x) => s + x.net, 0).toFixed(2) };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

function laneMatchups(ally: HeroData[], enemy: HeroData[], rel: RelationIndex, opts: PlayOptions): LaneMatchup[] {
  const a = assignLanes(ally.map((hero, i) => ({ hero, locked: opts.allyLocks?.[i] ?? null })));
  const b = assignLanes(enemy.map((hero, i) => ({ hero, locked: opts.enemyLocks?.[i] ?? null })));
  const out: LaneMatchup[] = [];
  for (const lane of LANES) {
    const x = ally[a.lanes.indexOf(lane)] ?? null;
    const y = enemy[b.lanes.indexOf(lane)] ?? null;
    if (!x && !y) continue;
    const comparable = x && y && x.id !== y.id && !sameGroup(x, y);
    const mine = comparable ? rel.getCounter(x.id, y.id) : undefined;
    const theirs = comparable ? rel.getCounter(y.id, x.id) : undefined;
    out.push({ lane, ally: x, enemy: y, net: comparable ? +rel.net(x.id, y.id).toFixed(2) : 0, mine: mine && mine.weight > 0 ? mine : undefined, theirs: theirs && theirs.weight > 0 ? theirs : undefined });
  }
  return out;
}

const teamComplete = (team: HeroData[]) => team.length >= 5 && team.every(profileUsable);

/** enemy 为空时只给出我方自己的打法（plan 与命中体系的分阶段说明） */
export function buildPlaybook(ctx: PlayContext, ally: HeroData[], enemy: HeroData[] = [], opts: PlayOptions = {}): Playbook {
  const items = ctx.bundle.playbook.flatMap((e) => {
    // 只涉及对面的条目在没有对面英雄时不求值
    if (!enemy.length && e.when.some((c) => c.side === 'enemy')) return [];
    if (!ally.length && e.when.some((c) => c.side === 'ally')) return [];
    const r = evalEntry(e, ally, enemy, ctx);
    return r ? [r] : [];
  });
  const of = (s: PlaySection) => items.filter((i) => i.section === s);
  const archetypes: Archetype[] = ctx.bundle.archetypes;
  return {
    allyArchetypes: matchArchetypes(ally, archetypes, ctx.tagName),
    enemyArchetypes: matchArchetypes(enemy, archetypes, ctx.tagName),
    plan: of('plan'),
    openings: of('opening'),
    dangers: of('danger'),
    builds: of('build'),
    focus: focusRows(ally, enemy, ctx.rel, 5),
    threats: focusRows(enemy, ally, ctx.rel, 5),
    lanes: ally.length && enemy.length ? laneMatchups(ally, enemy, ctx.rel, opts) : [],
    complete: { ally: teamComplete(ally), enemy: teamComplete(enemy) },
  };
}
