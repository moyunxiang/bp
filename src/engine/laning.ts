// 对线判断：三路对线、中辅抢线、射辅对线。
// 依据只有两类：教学视频里解说的明确说法（data/curated/laning.json，逐条核对过字幕出处并经独立复核），
// 以及已核实的机制标签（只作为事实展示，不用来下结论）。没有说法的地方显示“暂无说法”，不猜。
import { LANE_NAME, type HeroData, type Lane, type LaneAspect, type LaneClaim, type LaneLevel, type LaneName, type LaningData } from '../types.ts';
import { assignLanes, type LaneSlot } from './lanes.ts';
import { sameGroup } from './relations.ts';
import { verifiedTags } from './rules.ts';

const LANE_OF: Record<LaneName, Lane> = { 对抗路: 1, 打野: 2, 中路: 3, 发育路: 4, 游走: 5 };
const pairKey = (a: number, b: number) => a * 1000 + b;

export interface LaneIndex {
  data: LaningData | null;
  /** 不针对特定对手、搭档的说法，键为英雄ID */
  general: Map<number, LaneClaim[]>;
  /** 针对特定对手的说法，键为 pairKey(hero, vs) */
  versus: Map<number, LaneClaim[]>;
  /** 和特定队友搭档的说法，键为 pairKey(小ID, 大ID) */
  together: Map<number, LaneClaim[]>;
  /** 视频的UP主；同一位UP主的多个视频只算一个来源 */
  uploader: (bvid: string) => number | string;
}

export function buildLaneIndex(data: LaningData | null): LaneIndex {
  const ix: LaneIndex = { data, general: new Map(), versus: new Map(), together: new Map(), uploader: (bvid) => data?.videos[bvid]?.mid ?? bvid };
  const push = (m: Map<number, LaneClaim[]>, k: number, c: LaneClaim) => m.set(k, [...(m.get(k) ?? []), c]);
  for (const c of data?.claims ?? []) {
    if (c.vs != null) push(ix.versus, pairKey(c.hero, c.vs), c);
    else if (c.with != null) push(ix.together, pairKey(Math.min(c.hero, c.with), Math.max(c.hero, c.with)), c);
    else push(ix.general, c.hero, c);
  }
  return ix;
}

/** 汇总后的结论；mixed=不同UP主说法相反，不下结论 */
export type Consensus = LaneLevel | 'mixed';

export interface LaneView {
  aspect: LaneAspect;
  level: Consensus;
  /** 持这个结论的不同UP主数 */
  uploaders: number;
  claims: LaneClaim[];
}

/**
 * 按不同UP主汇总：只有一种说法就用它；强、弱两种说法都有时，多的一方至少多出两位UP主才算数，否则为 mixed。
 */
export function consensus(claims: LaneClaim[], uploader: LaneIndex['uploader']): { level: Consensus; uploaders: number } {
  const who: Record<LaneLevel, Set<number | string>> = { strong: new Set(), weak: new Set(), even: new Set() };
  for (const c of claims) who[c.level].add(uploader(c.bvid));
  const s = who.strong.size;
  const w = who.weak.size;
  if (s && w) return s >= w + 2 ? { level: 'strong', uploaders: s } : w >= s + 2 ? { level: 'weak', uploaders: w } : { level: 'mixed', uploaders: s + w };
  if (s) return { level: 'strong', uploaders: s };
  if (w) return { level: 'weak', uploaders: w };
  return { level: 'even', uploaders: who.even.size };
}

/** 说法是否适用于这个英雄走 lane 这一路：没有标明分路的都适用；发育路双人对线的说法对射手和辅助都适用 */
const applies = (c: LaneClaim, lane: Lane | null) => {
  if (!c.lane || lane == null) return true;
  if (LANE_OF[c.lane] === lane) return true;
  return c.aspect === 'duo' && (c.lane === '发育路' || c.lane === '游走') && (lane === 4 || lane === 5);
};

/** 某英雄某一方面的汇总；没有说法时为 null */
export function laneView(ix: LaneIndex, heroId: number, aspect: LaneAspect, lane: Lane | null = null): LaneView | null {
  const claims = (ix.general.get(heroId) ?? []).filter((c) => c.aspect === aspect && applies(c, lane));
  if (!claims.length) return null;
  return { aspect, claims, ...consensus(claims, ix.uploader) };
}

/** 按顺序取第一个有说法的方面 */
function firstView(ix: LaneIndex, heroId: number, aspects: LaneAspect[], lane: Lane | null): LaneView | null {
  for (const a of aspects) {
    const v = laneView(ix, heroId, a, lane);
    if (v) return v;
  }
  return null;
}

const SCORE: Record<Consensus, number | null> = { strong: 1, even: 0, weak: -1, mixed: null };

export type Edge = 'ally' | 'enemy' | 'even' | 'unknown';
export type DuelKey = 'top' | 'mid' | 'bot' | 'midRoam' | 'botRoam';

export interface LaneActor {
  hero: HeroData;
  lane: Lane;
  view: LaneView | null;
  /** 机制事实：被动、1技能、2技能里有范围伤害的技能（只在抢线判断里给出，不用来下结论） */
  clearSkills: string[];
}

export interface DirectClaim {
  claim: LaneClaim;
  /** 这条说法对哪一方有利 */
  favors: Edge;
}

export interface LaneDuel {
  key: DuelKey;
  title: string;
  /** 比的是什么 */
  about: string;
  ally: LaneActor[];
  enemy: LaneActor[];
  edge: Edge;
  /** direct=有点名双方的说法；both=双方各有说法；one=只有一方有说法；none=都没有 */
  basis: 'direct' | 'both' | 'one' | 'none';
  /** 点名了双方英雄的说法 */
  direct: DirectClaim[];
  /** 点名了同队两人搭档的说法 */
  pairs: { side: 'ally' | 'enemy'; claim: LaneClaim }[];
  /** 双方按说法折算的分（强+1、一般0、弱−1；没有说法的不计），仅用于比较 */
  score: { ally: number | null; enemy: number | null };
}

interface DuelDef {
  key: DuelKey;
  title: string;
  about: string;
  lanes: Lane[];
  /** 每一路取哪几个方面（按顺序取第一个有说法的） */
  aspects: (lane: Lane) => LaneAspect[];
  /** 点名对手的说法里，哪些方面算数 */
  versus: LaneAspect[];
  /** 搭档说法里，哪个方面算数；没有则不看搭档 */
  pair?: LaneAspect;
  clearFacts?: boolean;
}

const DUELS: DuelDef[] = [
  { key: 'top', title: '对抗路对线', about: '线上单人的换血、压制与抗压', lanes: [1], aspects: () => ['lane', 'early'], versus: ['lane', 'early'] },
  { key: 'mid', title: '中路对线', about: '线上单人的换血、压制与抗压', lanes: [3], aspects: () => ['lane', 'early'], versus: ['lane', 'early'] },
  { key: 'bot', title: '发育路对线', about: '射手单人层面的对线强弱', lanes: [4], aspects: () => ['lane', 'early'], versus: ['lane', 'early', 'duo'] },
  { key: 'midRoam', title: '中辅抢线', about: '开局中路和游走一起清第一波兵的快慢，决定谁先去河道', lanes: [3, 5], aspects: () => ['clear'], versus: ['clear'], pair: 'clear', clearFacts: true },
  { key: 'botRoam', title: '射辅对线', about: '射手加辅助在发育路的双人对线', lanes: [4, 5], aspects: (lane) => (lane === 4 ? ['duo', 'lane', 'early'] : ['duo', 'lane']), versus: ['duo', 'lane'], pair: 'duo' },
];

const CLEAR_SLOTS = ['被动', '1技能', '2技能'];
/** 开局两级内能用到的范围伤害技能（已核实标签） */
export function earlyClearSkills(h: HeroData): string[] {
  const slots = new Set(verifiedTags(h, ['aoe_damage']).map((t) => t.slot));
  return CLEAR_SLOTS.filter((s) => slots.has(s));
}

const flip = (level: LaneLevel): Edge => (level === 'strong' ? 'enemy' : level === 'weak' ? 'ally' : 'even');
const favor = (level: LaneLevel): Edge => (level === 'strong' ? 'ally' : level === 'weak' ? 'enemy' : 'even');

function sideScore(actors: LaneActor[], pairLevels: Consensus[]): number | null {
  const parts = [...actors.map((a) => (a.view ? SCORE[a.view.level] : null)), ...pairLevels.map((l) => SCORE[l])].filter((x): x is number => x != null);
  return parts.length ? parts.reduce((s, x) => s + x, 0) : null;
}

function duel(def: DuelDef, ix: LaneIndex, allyAt: Map<Lane, HeroData>, enemyAt: Map<Lane, HeroData>): LaneDuel | null {
  const actors = (at: Map<Lane, HeroData>): LaneActor[] =>
    def.lanes.flatMap((lane) => {
      const hero = at.get(lane);
      return hero ? [{ hero, lane, view: firstView(ix, hero.id, def.aspects(lane), lane), clearSkills: def.clearFacts ? earlyClearSkills(hero) : [] }] : [];
    });
  const ally = actors(allyAt);
  const enemy = actors(enemyAt);
  if (!ally.length && !enemy.length) return null;

  // 点名双方的说法：只比同一路的两个人；说法标明了分路时，要和现在所走的路一致
  const direct: DirectClaim[] = [];
  for (const a of ally)
    for (const e of enemy) {
      if (a.lane !== e.lane || a.hero.id === e.hero.id || sameGroup(a.hero, e.hero)) continue;
      for (const c of ix.versus.get(pairKey(a.hero.id, e.hero.id)) ?? []) if (def.versus.includes(c.aspect) && applies(c, a.lane)) direct.push({ claim: c, favors: favor(c.level) });
      for (const c of ix.versus.get(pairKey(e.hero.id, a.hero.id)) ?? []) if (def.versus.includes(c.aspect) && applies(c, e.lane)) direct.push({ claim: c, favors: flip(c.level) });
    }

  const pairs: LaneDuel['pairs'] = [];
  const pairLevels: Record<'ally' | 'enemy', Consensus[]> = { ally: [], enemy: [] };
  if (def.pair)
    for (const side of ['ally', 'enemy'] as const) {
      const team = side === 'ally' ? ally : enemy;
      if (team.length < 2) continue;
      const [x, y] = team;
      const claims = (ix.together.get(pairKey(Math.min(x.hero.id, y.hero.id), Math.max(x.hero.id, y.hero.id))) ?? []).filter((c) => c.aspect === def.pair);
      if (!claims.length) continue;
      for (const claim of claims) pairs.push({ side, claim });
      pairLevels[side].push(consensus(claims, ix.uploader).level);
    }

  const score = { ally: sideScore(ally, pairLevels.ally), enemy: sideScore(enemy, pairLevels.enemy) };
  let edge: Edge = 'unknown';
  let basis: LaneDuel['basis'] = 'none';
  // 点名双方的说法按不同UP主计，一边倒才算数
  const forAlly = new Set(direct.filter((d) => d.favors === 'ally').map((d) => ix.uploader(d.claim.bvid))).size;
  const forEnemy = new Set(direct.filter((d) => d.favors === 'enemy').map((d) => ix.uploader(d.claim.bvid))).size;
  const directSign = Math.sign(forAlly - forEnemy);
  const sign = (x: number): Edge => (x > 0 ? 'ally' : x < 0 ? 'enemy' : 'even');
  if (def.lanes.length === 1 && direct.length && (directSign !== 0 || (!forAlly && !forEnemy))) {
    // 单人对线：有点名双方的说法就以它为准
    edge = sign(directSign);
    basis = 'direct';
  } else if (def.lanes.length > 1 && direct.length) {
    // 二对二：点名双方的说法只涉及其中两个人，和其他人的说法合在一起算
    edge = sign(directSign + (score.ally ?? 0) - (score.enemy ?? 0));
    basis = 'direct';
  } else if (ally.length && enemy.length && score.ally != null && score.enemy != null) {
    edge = sign(score.ally - score.enemy);
    basis = 'both';
  } else if (score.ally != null || score.enemy != null) {
    // 只有一方有说法：强/弱可以给出倾向，“一般”不足以判断
    const s = score.ally ?? -(score.enemy as number);
    edge = s > 0 ? 'ally' : s < 0 ? 'enemy' : 'unknown';
    basis = 'one';
  }
  return { key: def.key, title: def.title, about: def.about, ally, enemy, edge, basis, direct, pairs, score };
}

/** 双方各路的英雄（由分路推断得到，可带手动锁定） */
export function lanesOf(slots: LaneSlot[]): Map<Lane, HeroData> {
  const a = assignLanes(slots);
  return new Map(slots.map((s, i) => [a.lanes[i], s.hero]));
}

/** 三路对线、中辅抢线、射辅对线。任一方没有人的路仍会列出已知一方的情况。 */
export function laneDuels(ix: LaneIndex, ally: LaneSlot[], enemy: LaneSlot[]): LaneDuel[] {
  if (!ix.data) return [];
  const a = lanesOf(ally);
  const e = lanesOf(enemy);
  return DUELS.flatMap((def) => {
    const d = duel(def, ix, a, e);
    return d ? [d] : [];
  });
}

export const EDGE_TEXT: Record<Edge, string> = { ally: '我方占优', enemy: '对方占优', even: '相当', unknown: '暂无结论' };
export const LEVEL_TEXT: Record<LaneAspect, Record<Consensus, string>> = {
  clear: { strong: '清线快', weak: '清线慢', even: '清线一般', mixed: '清线说法不一' },
  lane: { strong: '对线强', weak: '对线弱', even: '对线一般', mixed: '对线说法不一' },
  duo: { strong: '双人线强', weak: '双人线弱', even: '双人线一般', mixed: '双人线说法不一' },
  early: { strong: '前期强', weak: '前期弱', even: '前期一般', mixed: '前期说法不一' },
};

// ---------- 选人时的加减分 ----------

export interface LaningNote {
  delta: number;
  text: string;
  short?: string;
  /** direct=点名了对面同路英雄；both=和对面已选英雄比强弱；alone=对面这一路还没有可比的说法 */
  basis: 'direct' | 'both' | 'alone';
}

/** 每一档强弱差的分值；点名对手的说法单独计分。上限见 recommend.ts 的 laningCap。 */
export const LANING_POINTS = { perStep: 2, direct: 3, alone: 1 };

/**
 * 候选英雄走 lane 这一路时，对线方面的加减分：
 *   - 它所在的对线（对抗路 / 中路 / 发育路）、中辅抢线、射辅对线里，候选让我方变强还是变弱；
 *   - 对面这一路还没有人时，只按它自己的说法给一小部分分（对线强的英雄不容易被后手针对到没法打）。
 * 只用解说的明确说法；没有说法的英雄这一项为0。
 * teamAt / enemyAt：双方各路的英雄（分路推断的结果）。
 * them：文字里怎么称呼另一方（给对方算禁用威胁时，另一方是“本方”）。
 */
export function laningScore(ix: LaneIndex, candidate: HeroData, lane: Lane | null, teamAt: Map<Lane, HeroData>, enemyAt: Map<Lane, HeroData>, them = '对面'): LaningNote[] {
  if (!ix.data || lane == null) return [];
  // teamAt：候选加入后已选队友各自所在的路（不含候选）
  const allyAt = new Map(teamAt);
  allyAt.set(lane, candidate);
  const out: LaningNote[] = [];
  const usedAspects = new Set<LaneAspect>();
  const usedRivals = new Set<number>();
  for (const def of DUELS) {
    if (!def.lanes.includes(lane)) continue;
    const d = duel(def, ix, allyAt, enemyAt);
    if (!d) continue;
    const me = d.ally.find((a) => a.hero.id === candidate.id);
    if (!me) continue;
    // 点名了候选和对面同路英雄的说法：每个对手只计一次
    const rival = d.enemy.find((e) => e.lane === lane);
    const mine = rival ? d.direct.filter((x) => [x.claim.hero, x.claim.vs].includes(candidate.id) && [x.claim.hero, x.claim.vs].includes(rival.hero.id)) : [];
    if (rival && mine.length) {
      if (usedRivals.has(rival.hero.id)) continue;
      usedRivals.add(rival.hero.id);
      const net = new Set(mine.filter((x) => x.favors === 'ally').map((x) => ix.uploader(x.claim.bvid))).size - new Set(mine.filter((x) => x.favors === 'enemy').map((x) => ix.uploader(x.claim.bvid))).size;
      if (net !== 0) out.push({ delta: Math.sign(net) * LANING_POINTS.direct, text: `${LANE_NAME[lane]}对线：解说认为它对${rival.hero.name}${net > 0 ? '占优' : '吃亏'}`, short: `对线${rival.hero.name}${net > 0 ? '占优' : '吃亏'}`, basis: 'direct' });
      continue;
    }
    if (rival && usedRivals.has(rival.hero.id) && def.lanes.length === 1) continue;
    const own = me.view ? SCORE[me.view.level] : null;
    if (own == null || own === 0) continue;
    // 同一方面的说法只计一次（例如射手的“对线强”不在发育路对线和射辅对线里各算一遍）
    if (usedAspects.has(me.view!.aspect)) continue;
    usedAspects.add(me.view!.aspect);
    const word = LEVEL_TEXT[me.view!.aspect][me.view!.level];
    const rivals = d.enemy.filter((e) => e.view && SCORE[e.view.level] != null);
    if (rivals.length) {
      // 对面已经有人并且有说法：按强弱差计分
      const theirs = rivals.reduce((s, e) => s + SCORE[e.view!.level]!, 0) / rivals.length;
      const diff = own - theirs;
      if (diff === 0) continue;
      const names = rivals.map((e) => `${e.hero.name}${LEVEL_TEXT[e.view!.aspect][e.view!.level]}`).join('、');
      out.push({ delta: Math.round(diff * LANING_POINTS.perStep * 10) / 10, text: `${def.title}：解说认为它${word}，${them}${names}`, short: `${def.title}${diff > 0 ? '占优' : '吃亏'}（${word}）`, basis: 'both' });
    } else {
      out.push({ delta: own * LANING_POINTS.alone, text: `${def.title}：解说认为它${word}（${them}还没有可比的说法）`, short: `${LANE_NAME[lane]}${word}`, basis: 'alone' });
    }
  }
  return out;
}

/**
 * 两个英雄走同一路时，点名双方的说法偏向谁：返回偏向 a 的不同UP主数减去偏向 b 的。
 * 只看两人都常打的路（适配权重≥0.3）；用于“打算选的英雄 / 英雄池”还没有落位时的禁用判断。
 */
export function directLaneEdge(ix: LaneIndex, a: HeroData, b: HeroData): { net: number; lane: Lane } | null {
  if (!ix.data || a.id === b.id || sameGroup(a, b)) return null;
  let best: { net: number; lane: Lane } | null = null;
  for (const lane of [1, 3, 4, 5] as Lane[]) {
    if (a.lanes[lane - 1] < 0.3 || b.lanes[lane - 1] < 0.3) continue;
    const aspects = lane === 5 ? ['duo', 'lane', 'clear'] : lane === 4 ? ['lane', 'early', 'duo'] : lane === 3 ? ['lane', 'early', 'clear'] : ['lane', 'early'];
    const forA = new Set<number | string>();
    const forB = new Set<number | string>();
    for (const c of ix.versus.get(pairKey(a.id, b.id)) ?? []) if (aspects.includes(c.aspect) && applies(c, lane)) (c.level === 'strong' ? forA : c.level === 'weak' ? forB : new Set()).add(ix.uploader(c.bvid));
    for (const c of ix.versus.get(pairKey(b.id, a.id)) ?? []) if (aspects.includes(c.aspect) && applies(c, lane)) (c.level === 'strong' ? forB : c.level === 'weak' ? forA : new Set()).add(ix.uploader(c.bvid));
    const net = forA.size - forB.size;
    if (net !== 0 && (!best || Math.abs(net) > Math.abs(best.net))) best = { net, lane };
  }
  return best;
}
