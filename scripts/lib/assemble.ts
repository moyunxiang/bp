// 组装前端数据包。输入全部来自 data/derived（脚本产出）和 data/curated（整理的知识），不读取 data/raw。
// 回测会用“某个时间点之前的KPL统计”替换 kpl / comps 后重新组装，所以这里做成纯函数。
import { resolve } from 'node:path';
import { ROOT, exists, readJson } from './http.ts';
import {
  LANES,
  type Archetype,
  type BacktestReport,
  type CompFloorStats,
  type Bundle,
  type CommentaryItem,
  type HeroData,
  type HeroGuide,
  type HeroProfile,
  type KplComps,
  type KplStats,
  type LaningData,
  type OfficialEdge,
  type OfficialHero,
  type OutcomeTest,
  type PatchNote,
  type Rule,
  type PickModel,
  type PlayEntry,
  type TagDef,
  CampData,
} from '../../src/types.ts';

const D = (p: string) => resolve(ROOT, 'data', p);
const optional = async <T>(p: string, fallback: T): Promise<T> => ((await exists(p)) ? readJson<T>(p) : fallback);

export interface Inputs {
  official: { fetchedAt: string; heroes: OfficialHero[] };
  equipment: Bundle['equipment'];
  profiles: HeroProfile[];
  profileReport: Bundle['meta']['profileReport'];
  patches: { fetchedAt: string | null; season: { name: string } | null; latestPatchDate: string | null; patches: PatchNote[] };
  kpl: KplStats | null;
  comps: KplComps | null;
  floors: CompFloorStats | null;
  backtest: BacktestReport | null;
  model: PickModel | null;
  outcomeTest: OutcomeTest | null;
  guides: HeroGuide[];
  laning: LaningData | null;
  camp: CampData | null;
  commentary: CommentaryItem[];
  rules: Rule[];
  tags: TagDef[];
  archetypes: Archetype[];
  playbook: PlayEntry[];
  aliases: Record<string, string[]>;
  laneOverrides: Record<string, number[]>;
}

export async function loadInputs(): Promise<Inputs> {
  const equipment = await readJson<Bundle['equipment']>(D('derived/official/equipment.json'));
  return {
    official: await readJson(D('derived/official/heroes.json')),
    equipment: { items: equipment.items, runes: equipment.runes, summoners: equipment.summoners },
    profiles: (await optional<{ profiles: HeroProfile[] }>(D('derived/profiles.json'), { profiles: [] })).profiles,
    profileReport: await optional<Bundle['meta']['profileReport']>(D('derived/profile-report.json'), null),
    patches: await optional(D('derived/patches.json'), { fetchedAt: null, season: null, latestPatchDate: null, patches: [] as PatchNote[] }),
    kpl: await optional<KplStats | null>(D('derived/kpl/stats.json'), null),
    comps: await optional<KplComps | null>(D('derived/kpl/comps.json'), null),
    floors: await optional<CompFloorStats | null>(D('derived/kpl/floors.json'), null),
    backtest: await optional<BacktestReport | null>(D('derived/backtest.json'), null),
    model: await optional<PickModel | null>(D('derived/model.json'), null),
    outcomeTest: await optional<OutcomeTest | null>(D('derived/outcome-test.json'), null),
    guides: (await optional<{ guides: HeroGuide[] }>(D('derived/guides.json'), { guides: [] })).guides,
    laning: await optional<LaningData | null>(D('curated/laning.json'), null),
    camp: await optional<CampData | null>(D('derived/camp.json'), null),
    commentary: (await optional<{ items: CommentaryItem[] }>(D('derived/commentary.json'), { items: [] })).items,
    rules: (await readJson<{ rules: Rule[] }>(D('curated/rules.json'))).rules,
    tags: (await readJson<{ tags: TagDef[] }>(D('curated/tags.json'))).tags,
    archetypes: (await readJson<{ archetypes: Archetype[] }>(D('curated/archetypes.json'))).archetypes,
    playbook: (await optional<{ entries: PlayEntry[] }>(D('curated/playbook.json'), { entries: [] })).entries,
    aliases: (await readJson<{ aliases: Record<string, string[]> }>(D('curated/aliases.json'))).aliases,
    laneOverrides: (await optional<{ lanes: Record<string, number[]> }>(D('curated/lane-overrides.json'), { lanes: {} })).lanes,
  };
}

// 官方职业 → 默认分路（仅在既没有职业赛数据、官方分路字段又不可靠时使用）
const CLASS_LANES: Record<number, [number, number][]> = {
  1: [[1, 1], [2, 0.5]],
  2: [[3, 1]],
  3: [[5, 1], [1, 0.6]],
  4: [[2, 1]],
  5: [[4, 1]],
  6: [[5, 1]],
};
const KPL_MIN_GAMES = 10;

export function lanesFor(h: OfficialHero, kpl: KplStats | null, overrides: Record<string, number[]>): { lanes: number[]; source: string } {
  if (overrides[h.id]) return { lanes: overrides[h.id], source: '手动指定' };
  const lanes = [0, 0, 0, 0, 0];
  const sources: string[] = [];

  const k = kpl?.heroes[h.id]?.lanes;
  const kTotal = k ? k.reduce((s, x) => s + x, 0) : 0;
  if (k && kTotal >= KPL_MIN_GAMES) {
    const max = Math.max(...k);
    k.forEach((n, i) => {
      // 占比不足8%的分路视为偶发
      if (n / kTotal >= 0.08) lanes[i] = +(n / max).toFixed(2);
    });
    sources.push(`职业赛${kTotal}场`);
  }

  // 官方分路字段：值须在1–5内；新英雄常见“分路=职业编号”的填法，视为不可靠
  const roles = h.officialRoles.filter((r) => LANES.includes(r as never));
  const suspicious = h.releaseDate != null && h.officialRoles.length === 1 && h.officialRoles[0] === h.heroType;
  if (roles.length === h.officialRoles.length && roles.length && !suspicious) {
    roles.forEach((r, i) => {
      const w = i === 0 ? 1 : 0.6;
      // 有职业赛数据时，官方分路只作为补充（权重减半），避免盖过实际使用情况
      lanes[r - 1] = Math.max(lanes[r - 1], kTotal >= KPL_MIN_GAMES ? w * 0.5 : w);
    });
    sources.push('官方分路');
  }

  if (!sources.length) {
    for (const [lane, w] of CLASS_LANES[h.heroType] ?? []) lanes[lane - 1] = w;
    sources.push('按官方职业推定');
  }
  return { lanes, source: sources.join(' + ') };
}

const count = (text: string, word: string) => text.split(word).length - 1;

export function assemble(inp: Inputs): { bundle: Bundle; staleEdges: number } {
  const profileById = new Map(inp.profiles.map((p) => [p.id, p]));
  const heroes: HeroData[] = inp.official.heroes.map((h) => {
    const text = h.skills.map((s) => s.desc).join('\n');
    const { lanes, source } = lanesFor(h, inp.kpl, inp.laneOverrides);
    return {
      ...h,
      aliases: inp.aliases[h.name] ?? [],
      lanes,
      laneSource: source,
      profile: profileById.get(h.id) ?? null,
      dmg: { phys: count(text, '物理伤害'), magic: count(text, '法术伤害'), true: count(text, '真实伤害') },
      kpl: inp.kpl?.heroes[h.id] ?? null,
    };
  });
  const byId = new Map(heroes.map((h) => [h.id, h]));

  // ---- 官方关系边 ----
  const edges = new Map<string, OfficialEdge>();
  const addEdge = (type: 'counter' | 'synergy', a: number, b: number, page: number, text: string) => {
    const [x, y] = type === 'synergy' && a > b ? [b, a] : [a, b];
    const k = `${type}:${x}:${y}`;
    const e = edges.get(k) ?? { type, a: x, b: y, texts: [], stale: false };
    e.texts.push({ page, text });
    edges.set(k, e);
  };
  for (const h of heroes) {
    for (const r of h.relations.partners) addEdge('synergy', h.id, r.id, h.id, r.text);
    for (const r of h.relations.counters) addEdge('counter', h.id, r.id, h.id, r.text); // h 压制 r
    for (const r of h.relations.counteredBy) addEdge('counter', r.id, h.id, h.id, r.text); // r 压制 h
  }
  // 过期检查：说明文字里用【】点名的技能，若在双方当前技能名里都找不到，判为过期
  let staleEdges = 0;
  for (const e of edges.values()) {
    const names = new Set([...(byId.get(e.a)?.skills ?? []), ...(byId.get(e.b)?.skills ?? [])].map((s) => s.name));
    const cited = e.texts.flatMap((t) => [...t.text.matchAll(/【([^】]{2,8})】/g)].map((m) => m[1]));
    if (cited.some((c) => !names.has(c))) {
      e.stale = true;
      staleEdges++;
    }
  }

  const bundle: Bundle = {
    meta: {
      generatedAt: new Date().toISOString(),
      officialFetchedAt: inp.official.fetchedAt,
      newsFetchedAt: inp.patches.fetchedAt,
      season: inp.patches.season?.name ?? null,
      latestPatchDate: inp.patches.latestPatchDate,
      counts: {},
      profileReport: inp.profileReport,
      backtest: inp.backtest,
      outcomeTest: inp.outcomeTest ? { generatedAt: inp.outcomeTest.generatedAt, note: inp.outcomeTest.note, games: inp.outcomeTest.games, train: inp.outcomeTest.train, test: inp.outcomeTest.test, models: inp.outcomeTest.models.map(({ name, acc, logloss, auc }) => ({ name, acc, logloss, auc })), direct: inp.outcomeTest.direct } : null,
      pending: {
        needsReview: heroes.filter((h) => h.profile?.status === 'needs_review').map((h) => h.name),
        missingProfile: heroes.filter((h) => !h.profile).map((h) => h.name),
      },
    },
    // 官方页面的关系已合并进 officialEdges，前端英雄数据里不再重复携带
    heroes: heroes.map((h) => ({ ...h, relations: { partners: [], counters: [], counteredBy: [] } })),
    officialEdges: [...edges.values()].sort((x, y) => x.a - y.a || x.b - y.b),
    rules: inp.rules,
    tags: inp.tags,
    patches: inp.patches.patches.filter((p) => p.heroes.length).slice(0, 60),
    kpl: inp.kpl ? { coverage: inp.kpl.coverage, heat: inp.kpl.heat, pairs: inp.kpl.pairs, source: inp.kpl.source, resp: inp.kpl.resp, short: inp.kpl.short } : null,
    floors: inp.floors,
    model: inp.model,
    comps: inp.comps,
    archetypes: inp.archetypes,
    playbook: inp.playbook,
    equipment: inp.equipment,
    commentary: inp.commentary,
    guides: Object.fromEntries(inp.guides.filter((g) => byId.has(g.id)).map((g) => [g.id, g])),
    laning: inp.laning ? { ...inp.laning, claims: inp.laning.claims.filter((c) => byId.has(c.hero) && (c.vs == null || byId.has(c.vs)) && (c.with == null || byId.has(c.with))) } : null,
    camp: inp.camp,
  };
  return { bundle, staleEdges };
}
