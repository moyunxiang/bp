// 关系索引：把官方关系、规则推导、KPL同队共现、解说条目合并成可查询的克制/配合关系。
// 只有已核实且未过期的证据进入 weight；其余证据保留在 doubtful 里，仅供研究模式展示。
import { HERO_TYPE_NAME, type Bundle, type CommentaryItem, type HeroData, type ProfileTag, type Rule, type Scene } from '../types.ts';
import { evalCond } from './rules.ts';

export type Evidence =
  | { kind: 'official'; page: number; text: string }
  | { kind: 'rule'; rule: Rule; /** 规则自身方向上的双方英雄ID（配合关系按ID排序后可能与 Relation.a/b 对调） */ aId: number; bId: number; aTags: ProfileTag[]; bTags: ProfileTag[]; aNotes: string[]; bNotes: string[] }
  | { kind: 'kpl'; n: number; expected: number; lift: number }
  | { kind: 'commentary'; item: CommentaryItem };

export interface Relation {
  type: 'counter' | 'synergy';
  /** counter：a 克制 b；synergy：无方向 */
  a: number;
  b: number;
  weight: number;
  evidence: Evidence[];
  /** 存疑证据：过期的官方说明、未核实的解说条目。不计分。 */
  doubtful: Evidence[];
  scenes: Scene[];
}

// 各类证据的计分权重
export const W = {
  official: 1.0,
  officialCorroborated: 0.5, // 双方官方页面互相印证时的加成
  ruleCap: 0.8,
  kplCap: 0.8,
  commentary: 0.5,
  totalCap: 2.0,
};
export const KPL_MIN_LIFT = 1.3;

export const EVIDENCE_LEVEL: Record<Evidence['kind'], number> = { official: 1, rule: 0.4, kpl: 0.6, commentary: 0.5 };

const SCENE_KEYS: [Scene, RegExp][] = [
  ['对线', /对线|线上|换血|压线/],
  ['团战', /团战|开团|集火/],
  ['前期', /前期|前中期|一级|四级/],
  ['后期', /后期|大后期|装备成型/],
];
const scenesOfText = (t: string): Scene[] => {
  const s = SCENE_KEYS.filter(([, re]) => re.test(t)).map(([k]) => k);
  return s.length ? s : ['全局'];
};

const key = (a: number, b: number) => `${a}>${b}`;
const pairKey = (a: number, b: number) => (a < b ? `${a}+${b}` : `${b}+${a}`);

export class RelationIndex {
  private counter = new Map<string, Relation>();
  private synergy = new Map<string, Relation>();
  private byA = new Map<number, Relation[]>(); // a 克制谁
  private byB = new Map<number, Relation[]>(); // 谁克制 b
  private synOf = new Map<number, Relation[]>();
  readonly all: Relation[] = [];

  add(r: Relation) {
    if (r.type === 'counter') {
      this.counter.set(key(r.a, r.b), r);
      push(this.byA, r.a, r);
      push(this.byB, r.b, r);
    } else {
      this.synergy.set(pairKey(r.a, r.b), r);
      push(this.synOf, r.a, r);
      push(this.synOf, r.b, r);
    }
    this.all.push(r);
  }

  /** a 克制 b 的关系（单向） */
  getCounter(a: number, b: number) {
    return this.counter.get(key(a, b));
  }
  getSynergy(a: number, b: number) {
    return this.synergy.get(pairKey(a, b));
  }
  /** a 对 b 的净克制权重：正数表示 a 占优 */
  net(a: number, b: number) {
    return (this.getCounter(a, b)?.weight ?? 0) - (this.getCounter(b, a)?.weight ?? 0);
  }
  counters(a: number) {
    return this.byA.get(a) ?? [];
  }
  counteredBy(b: number) {
    return this.byB.get(b) ?? [];
  }
  synergies(a: number) {
    return this.synOf.get(a) ?? [];
  }
  synergyWeight(a: number, b: number) {
    return this.getSynergy(a, b)?.weight ?? 0;
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

interface Draft {
  type: 'counter' | 'synergy';
  a: number;
  b: number;
  evidence: Evidence[];
  doubtful: Evidence[];
  scenes: Set<Scene>;
}

export function relationWeight(evidence: Evidence[]): number {
  const official = evidence.filter((e) => e.kind === 'official');
  let w = 0;
  if (official.length) w += W.official + (new Set(official.map((e) => (e as { page: number }).page)).size > 1 ? W.officialCorroborated : 0);
  const rules = evidence.filter((e) => e.kind === 'rule') as Extract<Evidence, { kind: 'rule' }>[];
  if (rules.length) w += Math.min(W.ruleCap, rules.reduce((s, e) => s + e.rule.weight, 0));
  const kpl = evidence.find((e) => e.kind === 'kpl') as Extract<Evidence, { kind: 'kpl' }> | undefined;
  if (kpl) w += Math.min(W.kplCap, 0.5 * Math.log2(kpl.lift));
  if (evidence.some((e) => e.kind === 'commentary')) w += W.commentary;
  return +Math.min(W.totalCap, w).toFixed(3);
}

export function buildRelations(bundle: Bundle, tagName: (id: string) => string): RelationIndex {
  const heroes = bundle.heroes;
  const drafts = new Map<string, Draft>();
  const get = (type: 'counter' | 'synergy', a: number, b: number) => {
    const k = type === 'counter' ? `c${key(a, b)}` : `s${pairKey(a, b)}`;
    let d = drafts.get(k);
    if (!d) {
      d = type === 'counter' ? { type, a, b, evidence: [], doubtful: [], scenes: new Set() } : { type, a: Math.min(a, b), b: Math.max(a, b), evidence: [], doubtful: [], scenes: new Set() };
      drafts.set(k, d);
    }
    return d;
  };

  // 1. 官方关系
  for (const e of bundle.officialEdges) {
    const d = get(e.type, e.a, e.b);
    for (const t of e.texts) {
      const ev: Evidence = { kind: 'official', page: t.page, text: t.text };
      (e.stale ? d.doubtful : d.evidence).push(ev);
      if (!e.stale) scenesOfText(t.text).forEach((s) => d.scenes.add(s));
    }
  }

  // 2. 规则推导
  const typeName = (t: number) => HERO_TYPE_NAME[t] ?? '';
  for (const rule of bundle.rules) {
    const as = heroes.map((h) => ({ h, r: evalCond(h, rule.a, typeName, tagName) })).filter((x) => x.r.ok);
    const bs = heroes.map((h) => ({ h, r: evalCond(h, rule.b, typeName, tagName) })).filter((x) => x.r.ok);
    for (const A of as)
      for (const B of bs) {
        if (A.h.id === B.h.id || sameGroup(A.h, B.h)) continue;
        if (rule.symmetric && A.h.id > B.h.id) continue;
        const d = get(rule.type, A.h.id, B.h.id);
        // synergy 关系的 a/b 可能被排序过，证据里保持规则自己的方向
        d.evidence.push({ kind: 'rule', rule, aId: A.h.id, bId: B.h.id, aTags: A.r.tags, bTags: B.r.tags, aNotes: A.r.notes, bNotes: B.r.notes });
        rule.scenes.forEach((s) => d.scenes.add(s));
      }
  }

  // 3. KPL同队共现
  for (const p of bundle.kpl?.pairs.list ?? []) {
    if (p.lift < KPL_MIN_LIFT) continue;
    const d = get('synergy', p.a, p.b);
    d.evidence.push({ kind: 'kpl', n: p.n, expected: p.expected, lift: p.lift });
    d.scenes.add('全局');
  }

  // 4. 解说条目
  for (const c of bundle.commentary) {
    if (c.type === 'tip' || c.b == null) continue;
    const d = get(c.type, c.a, c.b);
    (c.status === 'verified' ? d.evidence : d.doubtful).push({ kind: 'commentary', item: c });
  }

  const idx = new RelationIndex();
  for (const d of drafts.values()) {
    idx.add({ type: d.type, a: d.a, b: d.b, weight: relationWeight(d.evidence), evidence: d.evidence, doubtful: d.doubtful, scenes: [...d.scenes] });
  }
  return idx;
}

export const sameGroup = (a: HeroData, b: HeroData) => a.groupId != null && a.groupId === b.groupId;

/** 关系中等级最高的证据，用于可信程度计算 */
export function bestEvidenceLevel(r: Relation | undefined): number {
  if (!r || !r.evidence.length) return 0;
  return Math.max(...r.evidence.map((e) => EVIDENCE_LEVEL[e.kind]));
}
