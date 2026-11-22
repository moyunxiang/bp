// BP推荐：对每个可选英雄计算“推荐分”。推荐分是多个可解释分项之和，不是胜率。
import { LANE_NAME, type Bundle, type HeroData, type Lane, type PickModel } from '../types.ts';
import { assignLanes, laneFitFor, type LaneSlot } from './lanes.ts';
import { bestEvidenceLevel, type Relation, type RelationIndex } from './relations.ts';
import { needsScore } from './comp.ts';
import { enemyCanStillRespond, other, pickedIds, unavailableReason, type DraftState, type Side, type Slot } from './draft.ts';

/** 各分项的权重与上限。回测脚本可以覆盖这些值。 */
export interface Weights {
  counterPerUnit: number;
  counterSameLane: number;
  counterCap: number;
  synergyPerUnit: number;
  synergyCap: number;
  /** 阵容需求各条提示的缩放 */
  needsScale: number;
  needsCap: number;
  laneFit: number;
  laneMiss: number;
  metaRange: number;
  patch: number;
  exposurePerUnit: number;
  exposureCap: number;
  poolPerLevel: number;
  /** 职业赛选人响应（对面亮出某英雄后 / 队友选了某英雄后）每单位对数提升度的分值与上限 */
  proPerUnit: number;
  proCap: number;
  /** 职业赛该位置选取率（0–1）乘以这个值 */
  lanePickRange: number;
  /** 职业赛第一局禁用率（0–1）乘以这个值 */
  banRange: number;
}

// 取值说明：最初克制/配合/暴露/需求的权重是现在的3–4倍。职业赛回测显示，那样会让排序明显偏离职业队的实际选择
// （Top10命中率从约61%降到约45%），而缩小到现在的量级后基本不再拖累，并且在第3–6手略有帮助。
// 所以这里让“职业赛热度 + 分路”决定大致排序，克制与配合在其上做调整。详见 scripts/backtest.ts 和数据说明页。
export const DEFAULT_WEIGHTS: Weights = {
  counterPerUnit: 2.2,
  counterSameLane: 1.3,
  counterCap: 6,
  synergyPerUnit: 1.8,
  synergyCap: 5,
  needsScale: 0.3,
  needsCap: 4,
  laneFit: 10,
  laneMiss: -25,
  metaRange: 12,
  patch: 2,
  exposurePerUnit: 0.9,
  exposureCap: 3.5,
  poolPerLevel: 3,
  proPerUnit: 3,
  proCap: 6,
  lanePickRange: 20,
  banRange: 10,
};

export type PartKey = 'counter' | 'synergy' | 'needs' | 'lane' | 'meta' | 'exposure' | 'proVs' | 'proAlly' | 'lanePick' | 'lanePickRecent' | 'banPri' | 'pool';
export const PART_NAME: Record<PartKey, string> = {
  counter: '克制与被克',
  synergy: '配合己方',
  needs: '阵容需求',
  lane: '分路匹配',
  meta: '版本因素',
  exposure: '先手暴露',
  proVs: '职业赛针对选择',
  proAlly: '职业赛同队选择',
  lanePick: '职业赛该位置选取（近一年）',
  lanePickRecent: '职业赛该位置选取（近60天）',
  banPri: '职业赛禁用率',
  pool: '英雄池',
};

/** 没有训练模型时的系数：新增的三个职业赛分项不参与，其余按手工权重 */
export const HAND_MULT: Record<string, number> = { proVs: 0, proAlly: 0, lanePick: 0, lanePickRecent: 0, banPri: 0 };
/** 选人响应统计的平滑常数：对数提升度 = ln((实际+K)/(期望+K)) */
export const RESP_SMOOTH = 4;
/** 响应统计的键 */
export const respKey = (c: number, o: number) => c * 1000 + o;

export interface ReasonItem {
  delta: number;
  text: string;
  /** 用于一句话理由的简短说法 */
  short?: string;
  /** 涉及的关系，用于研究模式展示证据 */
  relation?: Relation;
  hero?: HeroData;
}

export interface Part {
  key: PartKey;
  value: number;
  items: ReasonItem[];
}

export type Confidence = '高' | '中' | '低';

export interface Recommendation {
  hero: HeroData;
  score: number;
  parts: Part[];
  /** 最重要的一两句理由 */
  headline: string;
  confidence: Confidence;
  /** 已选英雄中，与候选之间存在已核实关系的数量 / 已选英雄总数 */
  coverage: { covered: number; total: number };
  confidenceNote: string;
  lane: Lane | null;
  /** 选它之后最该禁/最该防的英雄 */
  threats: { hero: HeroData; weight: number }[];
}

export interface PoolEntry {
  id: number;
  /** 熟练度 1–3 */
  level: number;
}

export interface RecommendOptions {
  side: Side;
  /** 只在英雄池内推荐 */
  pool?: PoolEntry[] | null;
  /** 指定候选要打的位置 */
  wantLane?: Lane | null;
  weights?: Weights;
  /** 覆盖各分项的系数（回测取原始分项时用）；不传则用训练模型，没有模型用手工权重 */
  mult?: Record<string, number>;
  /** 用于判断“近期改动”的当前日期（ISO），默认取数据生成时间 */
  today?: string;
  limit?: number;
}

export interface MetaStat {
  pick: number;
  ban: number;
  games: number;
  presence: number;
  banRate: number;
}

export interface Engine {
  bundle: Bundle;
  byId: Map<number, HeroData>;
  rel: RelationIndex;
  /** 职业赛第一局的禁选情况：presence=(被选+被禁)/局数，banRate=被禁/局数。没有数据的英雄不在表里 */
  meta: Map<number, MetaStat>;
  metaScope: 'recent' | 'year' | null;
  /** 职业赛选人响应：键 respKey(候选, 已选英雄) → [实际次数, 期望次数] */
  resp: { vs: Map<number, [number, number]>; ally: Map<number, [number, number]> };
  model: PickModel | null;
}

export function buildResp(bundle: Bundle): Engine['resp'] {
  const toMap = (list: [number, number, number, number][] | undefined) => new Map((list ?? []).map(([c, o, obs, exp]) => [respKey(c, o), [obs, exp] as [number, number]]));
  return { vs: toMap(bundle.kpl?.resp?.vs), ally: toMap(bundle.kpl?.resp?.ally) };
}

/** 当前这一手使用的分项系数。order 是本局第几手选人（1–10）。 */
export function multFor(model: PickModel | null, order: number, laneGiven = false): Record<string, number> {
  if (!model) return HAND_MULT;
  const phases = (laneGiven && model.lanePhases) || model.phases;
  const ph = phases.find((p) => order >= p.fromOrder && order <= p.toOrder) ?? phases[phases.length - 1];
  // 指定位置的系数是在“只看能打该位置的英雄”的条件下学出来的，分路系数可能很小；
  // 线上候选是全部英雄，所以分路系数同样不低于下限，保证不打这个位置的英雄排在后面
  const floor = model.floors?.lane ?? 0;
  return laneGiven && (ph.mult.lane ?? 0) < floor ? { ...ph.mult, lane: floor } : ph.mult;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const round1 = (x: number) => Math.round(x * 10) / 10;

/** 第一局禁选统计。优先用近期窗口；样本不足20局时退到一年窗口，再不足则不使用。 */
export function buildMeta(bundle: Bundle): Pick<Engine, 'meta' | 'metaScope'> {
  const heat = bundle.kpl?.heat;
  const scope: 'recent' | 'year' | null = heat ? (heat.recent.games >= 20 ? 'recent' : heat.year.games >= 20 ? 'year' : null) : null;
  const meta = new Map<number, MetaStat>();
  if (!scope || !heat) return { meta, metaScope: null };
  const games = heat[scope].games;
  for (const h of bundle.heroes) {
    if (!h.kpl || h.isLimited) continue;
    const g = scope === 'recent' ? h.kpl.g1Recent : h.kpl.g1Year;
    if (g.pick + g.ban === 0) continue;
    meta.set(h.id, { pick: g.pick, ban: g.ban, games, presence: Math.min(1, (g.pick + g.ban) / games), banRate: Math.min(1, g.ban / games) });
  }
  return { meta, metaScope: scope };
}

function teamSlots(d: DraftState, side: Side, byId: Map<number, HeroData>): LaneSlot[] {
  const out: LaneSlot[] = [];
  d.picks[side].forEach((id, i) => {
    if (id != null && byId.has(id)) out.push({ hero: byId.get(id)!, locked: d.laneLocks[side][i] });
  });
  return out;
}

/** 近期官方改动：只认公告标题写明“增强/削弱”的条目 */
function recentPatch(bundle: Bundle, heroId: number, today: string, days = 45) {
  const cutoff = new Date(new Date(today).getTime() - days * 86400_000).toISOString().slice(0, 10);
  for (const p of bundle.patches) {
    if (p.date < cutoff) break;
    const h = p.heroes.find((x) => x.id === heroId && x.direction !== 'adjust');
    if (h) return { patch: p, direction: h.direction as 'buff' | 'nerf' };
  }
  return null;
}

export function candidates(engine: Engine, d: DraftState, slot: Slot): HeroData[] {
  return engine.bundle.heroes.filter((h) => unavailableReason(d, h, slot, engine.byId) == null);
}

export function recommendPicks(engine: Engine, d: DraftState, opts: RecommendOptions): Recommendation[] {
  const W = opts.weights ?? DEFAULT_WEIGHTS;
  const { rel, byId, bundle } = engine;
  const side = opts.side;
  const today = opts.today ?? bundle.meta.generatedAt;
  const allySlots = teamSlots(d, side, byId);
  const enemySlots = teamSlots(d, other(side), byId);
  const allies = allySlots.map((s) => s.hero);
  const enemies = enemySlots.map((s) => s.hero);
  const enemyLanes = assignLanes(enemySlots);
  const slot: Slot = { side, kind: 'pick', index: Math.max(0, d.picks[side].indexOf(null)) };
  const poolMap = opts.pool ? new Map(opts.pool.map((p) => [p.id, p.level])) : null;
  const enemyResponds = enemyCanStillRespond(d, side);
  const enemyRemaining = d.picks[other(side)].filter((x) => x == null).length;
  const order = allies.length + enemies.length + 1;
  const mult = opts.mult ?? multFor(engine.model, order, opts.wantLane != null);
  const pairGames = bundle.kpl?.pairs.teamGames ?? 0;

  // 对方还能选到的英雄（用于暴露度）
  const enemyPool = enemyResponds ? candidates(engine, d, { side: other(side), kind: 'pick', index: 0 }) : [];

  const out: Recommendation[] = [];
  for (const h of candidates(engine, d, slot)) {
    if (poolMap && !poolMap.has(h.id)) continue;
    const parts: Part[] = [];

    // ---- 分路 ----
    const lf = laneFitFor(h, allySlots, opts.wantLane);
    const laneItems: ReasonItem[] = [];
    let laneValue: number;
    if (lf.fit < 0.15) {
      laneValue = W.laneMiss;
      laneItems.push({ delta: W.laneMiss, text: opts.wantLane ? `它通常不打${LANE_NAME[opts.wantLane]}` : '本方剩下的分路都不是它的常规位置' });
    } else {
      laneValue = round1((lf.fit - 0.5) * W.laneFit);
      if (lf.lane) laneItems.push({ delta: laneValue, text: `可以打${LANE_NAME[lf.lane]}（适配度${Math.round(lf.fit * 100)}%，来源：${h.laneSource}）` });
    }
    parts.push({ key: 'lane', value: laneValue, items: laneItems });

    // ---- 克制与被克 ----
    const counterItems: ReasonItem[] = [];
    let covered = 0;
    let levelSum = 0;
    enemies.forEach((e, i) => {
      const fwd = rel.getCounter(h.id, e.id);
      const back = rel.getCounter(e.id, h.id);
      const best = Math.max(bestEvidenceLevel(fwd), bestEvidenceLevel(back));
      if (best > 0) {
        covered++;
        levelSum += best;
      }
      const sameLane = lf.lane != null && enemyLanes.lanes[i] === lf.lane ? W.counterSameLane : 1;
      if (fwd?.weight) counterItems.push({ delta: round1(fwd.weight * W.counterPerUnit * sameLane), text: `克制${e.name}${sameLane > 1 ? '（同路对线）' : ''}`, relation: fwd, hero: e });
      if (back?.weight) counterItems.push({ delta: -round1(back.weight * W.counterPerUnit * sameLane), text: `被${e.name}克制${sameLane > 1 ? '（同路对线）' : ''}`, relation: back, hero: e });
    });
    const counterValue = clamp(counterItems.reduce((s, x) => s + x.delta, 0), -W.counterCap, W.counterCap);
    parts.push({ key: 'counter', value: round1(counterValue), items: counterItems.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)) });

    // ---- 配合 ----
    const synItems: ReasonItem[] = [];
    for (const a of allies) {
      const s = rel.getSynergy(h.id, a.id);
      const best = bestEvidenceLevel(s);
      if (best > 0) {
        covered++;
        levelSum += best;
      }
      if (s?.weight) synItems.push({ delta: round1(s.weight * W.synergyPerUnit), text: `与${a.name}有配合`, relation: s, hero: a });
    }
    const synValue = clamp(synItems.reduce((s, x) => s + x.delta, 0), 0, W.synergyCap);
    parts.push({ key: 'synergy', value: round1(synValue), items: synItems.sort((a, b) => b.delta - a.delta) });

    // ---- 阵容需求 ----
    const needItems = needsScore(h, allies).map((n) => ({ ...n, delta: round1(n.delta * W.needsScale) }));
    parts.push({ key: 'needs', value: round1(clamp(needItems.reduce((s, x) => s + x.delta, 0), -W.needsCap, W.needsCap)), items: needItems });

    // ---- 版本因素 ----
    const metaItems: ReasonItem[] = [];
    let metaValue = 0;
    // 只做加分：职业赛出场是正面证据，但没出场不代表在路人局弱
    const ms = engine.meta.get(h.id);
    if (ms) {
      const v = round1(ms.presence * W.metaRange);
      metaValue += v;
      metaItems.push({ delta: v, text: `职业赛第一局：${ms.games}局中被选${ms.pick}次、被禁${ms.ban}次（不代表路人局强度）`, short: `职业赛第一局选${ms.pick}禁${ms.ban}（共${ms.games}局）` });
    }
    const rp = recentPatch(bundle, h.id, today);
    if (rp) {
      const v = rp.direction === 'buff' ? W.patch : -W.patch;
      metaValue += v;
      metaItems.push({ delta: v, text: `${rp.patch.date}官方公告：${rp.direction === 'buff' ? '增强' : '削弱'}`, short: `近期官方${rp.direction === 'buff' ? '增强' : '削弱'}` });
    }
    parts.push({ key: 'meta', value: round1(metaValue), items: metaItems });

    // ---- 先手暴露 ----
    const threatList = enemyPool
      .filter((e) => e.id !== h.id)
      .map((e) => ({ hero: e, weight: rel.net(e.id, h.id) }))
      .filter((x) => x.weight > 0)
      .sort((a, b) => b.weight - a.weight);
    const expItems: ReasonItem[] = [];
    let expValue = 0;
    if (enemyResponds && threatList.length) {
      const top = threatList.slice(0, 4);
      const raw = top.reduce((s, x) => s + x.weight, 0) * W.exposurePerUnit * (enemyRemaining / 5);
      expValue = -round1(Math.min(W.exposureCap, raw));
      expItems.push({ delta: expValue, text: `对方还有${enemyRemaining}手可选，未被禁的克制英雄：${top.map((x) => x.hero.name).join('、')}`, short: `怕${top.slice(0, 3).map((x) => x.hero.name).join('、')}` });
    }
    parts.push({ key: 'exposure', value: expValue, items: expItems });

    // ---- 职业赛选人响应（按BP顺序统计的选人行为，不是胜负，也不等于机制克制）----
    const respPart = (key: 'proVs' | 'proAlly', others: HeroData[], table: Map<number, [number, number]>, say: (o: HeroData) => string) => {
      const items: ReasonItem[] = [];
      for (const o of others) {
        const r = table.get(respKey(h.id, o.id));
        if (!r) continue;
        const v = round1(Math.log((r[0] + RESP_SMOOTH) / (r[1] + RESP_SMOOTH)) * W.proPerUnit);
        if (Math.abs(v) < 0.3) continue;
        items.push({ delta: v, text: `职业赛近一年：${say(o)}，它被选了${r[0]}次（按它的平均被选概率预计约${r[1].toFixed(1)}次）`, short: v > 0 ? `职业赛常在${key === 'proVs' ? '对面有' : '搭配'}${o.name}时选它` : undefined, hero: o });
      }
      parts.push({ key, value: round1(clamp(items.reduce((s, x) => s + x.delta, 0), -W.proCap, W.proCap)), items: items.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)) });
    };
    respPart('proVs', enemies, engine.resp.vs, (o) => `对面先亮出${o.name}之后`);
    respPart('proAlly', allies, engine.resp.ally, (o) => `队友先选了${o.name}之后`);

    // ---- 职业赛该位置选取 ----
    const laneN = lf.lane && pairGames ? (h.kpl?.lanesYear?.[lf.lane - 1] ?? 0) : 0;
    const lanePickValue = pairGames ? round1((laneN / pairGames) * W.lanePickRange) : 0;
    parts.push({
      key: 'lanePick',
      value: lanePickValue,
      items: laneN && lf.lane ? [{ delta: lanePickValue, text: `职业赛近一年：${pairGames}个队伍场次中有${laneN}次用它打${LANE_NAME[lf.lane]}（不代表路人局强度）`, short: `职业赛${LANE_NAME[lf.lane]}出场${laneN}次` }] : [],
    });

    const shortGames = bundle.kpl?.short?.teamGames ?? 0;
    const laneShortN = lf.lane && shortGames ? (h.kpl?.lanesShort?.[lf.lane - 1] ?? 0) : 0;
    const laneShortValue = shortGames >= 40 ? round1((laneShortN / shortGames) * W.lanePickRange) : 0;
    parts.push({
      key: 'lanePickRecent',
      value: laneShortValue,
      items: laneShortValue && lf.lane ? [{ delta: laneShortValue, text: `职业赛近${bundle.kpl!.short!.windowDays}天：${shortGames}个队伍场次中有${laneShortN}次用它打${LANE_NAME[lf.lane]}（不代表路人局强度）`, short: `近${bundle.kpl!.short!.windowDays}天职业赛${LANE_NAME[lf.lane]}出场${laneShortN}次` }] : [],
    });

    // ---- 职业赛禁用率：经常被禁的英雄放出来时值得优先考虑 ----
    const banValue = ms ? round1(ms.banRate * W.banRange) : 0;
    parts.push({ key: 'banPri', value: banValue, items: banValue >= 0.5 && ms ? [{ delta: banValue, text: `职业赛第一局：${ms.games}局中被禁${ms.ban}次（不代表路人局强度）`, short: `职业赛常被禁（${ms.ban}/${ms.games}局）` }] : [] });

    // ---- 应用模型系数 ----
    for (const p of parts) {
      const m = mult[p.key] ?? 1;
      if (m === 1) continue;
      p.value = round1(p.value * m);
      p.items = m === 0 ? [] : p.items.map((i) => ({ ...i, delta: round1(i.delta * m) }));
    }

    // ---- 英雄池 ----
    if (poolMap) {
      const level = poolMap.get(h.id) ?? 1;
      const v = (level - 1) * W.poolPerLevel;
      parts.push({ key: 'pool', value: v, items: v ? [{ delta: v, text: `熟练度 ${'★'.repeat(level)}` }] : [] });
    }

    const score = Math.round(clamp(50 + parts.reduce((s, p) => s + p.value, 0), 0, 100));

    // ---- 可信程度 ----
    const total = enemies.length + allies.length;
    const cov = total ? levelSum / total : 0;
    const confidence: Confidence = total === 0 ? '低' : cov >= 0.5 ? '高' : cov >= 0.25 ? '中' : '低';
    const confidenceNote =
      total === 0
        ? '还没有已选英雄，分数只反映职业热度和分路'
        : covered === 0
          ? '与已选英雄之间没有已核实的关系，主要依据阵容需求与职业热度'
          : `与${covered}/${total}个已选英雄有已核实的关系`;

    // 一句话理由：优先说克制、配合、阵容需求；不够两条再补职业赛数据；最后带一条最主要的风险
    const say = (i: ReasonItem) => i.short ?? i.text.replace(/（.*?）/g, '');
    const byKey = (k: PartKey) => parts.find((p) => p.key === k)?.items ?? [];
    const core = [...byKey('counter'), ...byKey('synergy'), ...byKey('needs'), ...byKey('proVs').filter((i) => i.short), ...byKey('proAlly').filter((i) => i.short)].filter((i) => i.delta >= 0.5).sort((a, b) => b.delta - a.delta);
    const positives = core.slice(0, 2).map(say);
    if (positives.length < 2) positives.push(...[...byKey('lanePickRecent'), ...byKey('lanePick'), ...byKey('meta')].filter((i) => i.delta >= 1).slice(0, 2 - positives.length).map(say));
    const risk = [...byKey('counter'), ...byKey('needs'), ...byKey('lane'), ...byKey('exposure')].filter((i) => i.delta <= -0.7).sort((a, b) => a.delta - b.delta)[0];
    const headline = [...positives, ...(risk ? [risk.short ?? `注意${say(risk)}`] : [])].join('；') || '没有突出的加分或减分项';

    out.push({ hero: h, score, parts, headline, confidence, coverage: { covered, total }, confidenceNote, lane: lf.lane, threats: threatList.slice(0, 3) });
  }

  out.sort((a, b) => b.score - a.score || (engine.meta.get(b.hero.id)?.presence ?? 0) - (engine.meta.get(a.hero.id)?.presence ?? 0) || a.hero.id - b.hero.id);
  return opts.limit ? out.slice(0, opts.limit) : out;
}

// ---------- Ban 推荐 ----------

export interface BanRecommendation {
  hero: HeroData;
  score: number;
  items: ReasonItem[];
  headline: string;
  confidence: Confidence;
}

export interface BanOptions {
  /** 为哪一方推荐禁用 */
  side: Side;
  pool?: PoolEntry[] | null;
  /** 我方打算选的英雄（候选对比或意向英雄），禁用其克星 */
  intents?: number[];
  wantLane?: Lane | null;
  limit?: number;
}

export function recommendBans(engine: Engine, d: DraftState, opts: BanOptions): BanRecommendation[] {
  const { rel, byId } = engine;
  const side = opts.side;
  const allies = pickedIds(d, side).map((id) => byId.get(id)!).filter(Boolean);
  const enemies = pickedIds(d, other(side)).map((id) => byId.get(id)!).filter(Boolean);
  const enemySlots = teamSlots(d, other(side), byId);
  const slot: Slot = { side, kind: 'ban', index: Math.max(0, d.bans[side].indexOf(null)) };
  const intents = (opts.intents ?? []).map((id) => byId.get(id)).filter((h): h is HeroData => !!h);
  // 英雄池里可能要用的英雄：指定了位置时只看能打这个位置的
  const poolHeroes = (opts.pool ?? [])
    .map((p) => ({ hero: byId.get(p.id), level: p.level }))
    .filter((p): p is { hero: HeroData; level: number } => !!p.hero && (!opts.wantLane || p.hero.lanes[opts.wantLane - 1] >= 0.3));
  const enemyFull = enemies.length >= 5;

  const out: BanRecommendation[] = [];
  for (const h of engine.bundle.heroes) {
    if (unavailableReason(d, h, slot, byId) != null) continue;
    if (d.bans[other(side)].includes(h.id)) continue; // 对方已经禁了
    const items: ReasonItem[] = [];
    let evidence = 0;

    // 对方已选满时，禁用只有“阻止交换”意义，不再推荐
    if (enemyFull) continue;

    // 对方能不能用上它：对方剩余分路要有它的位置
    const fit = enemySlots.length ? laneFitFor(h, enemySlots).fit : 1;
    if (fit < 0.15) continue;

    for (const a of allies) {
      const w = rel.net(h.id, a.id);
      if (w > 0) {
        items.push({ delta: round1(w * 7), text: `克制本方已选的${a.name}`, relation: rel.getCounter(h.id, a.id), hero: a });
        evidence++;
      }
    }
    for (const a of intents) {
      const w = rel.net(h.id, a.id);
      if (w > 0) {
        items.push({ delta: round1(w * 7), text: `克制打算选的${a.name}`, relation: rel.getCounter(h.id, a.id), hero: a });
        evidence++;
      }
    }
    if (poolHeroes.length && !intents.length) {
      const hit = poolHeroes.filter((p) => rel.net(h.id, p.hero.id) > 0);
      if (hit.length) {
        const w = hit.reduce((s, p) => s + rel.net(h.id, p.hero.id) * (0.6 + 0.2 * p.level), 0) / Math.max(3, poolHeroes.length);
        items.push({ delta: round1(w * 14), text: `克制我的英雄池：${hit.slice(0, 3).map((p) => p.hero.name).join('、')}${hit.length > 3 ? '等' : ''}` });
        evidence++;
      }
    }
    for (const e of enemies) {
      const s = rel.getSynergy(h.id, e.id);
      if (s?.weight) {
        items.push({ delta: round1(s.weight * 4), text: `能与对方已选的${e.name}配合`, relation: s, hero: e });
        evidence++;
      }
    }
    const ms = engine.meta.get(h.id);
    if (ms) {
      const v = round1((0.7 * ms.banRate + 0.3 * ms.presence) * 20);
      items.push({ delta: v, text: v >= 2 ? `职业赛第一局：${ms.games}局中被禁${ms.ban}次、被选${ms.pick}次（不代表路人局强度）` : '' });
    }

    const score = Math.round(clamp(30 + items.reduce((s, x) => s + x.delta, 0), 0, 100));
    const shown = items.filter((i) => i.text).sort((a, b) => b.delta - a.delta);
    if (!shown.length) continue;
    out.push({
      hero: h,
      score,
      items: shown,
      headline: shown.slice(0, 2).map((i) => i.text.replace(/（.*?）/g, '')).join('；'),
      confidence: evidence >= 2 ? '高' : evidence === 1 ? '中' : '低',
    });
  }
  out.sort((a, b) => b.score - a.score || a.hero.id - b.hero.id);
  return opts.limit ? out.slice(0, opts.limit) : out;
}
