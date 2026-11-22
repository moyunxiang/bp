// 引擎测试：使用真实数据包（public/data/bundle.json），覆盖分路推断、BP规则、关系权重、推荐评分。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Bundle, HeroData } from '../src/types.ts';
import { makeEngine } from '../src/lib/data.ts';
import { assignLanes, laneFitFor } from '../src/engine/lanes.ts';
import { MODE_INFO, PICK_ORDER, activeSlot, isComplete, newDraft, place, sequence, setBanCount, setLaneLock, unavailableReason, type DraftState, type Slot } from '../src/engine/draft.ts';
import { DEFAULT_WEIGHTS, HAND_MULT, multFor, recommendBans, recommendPicks, type Engine } from '../src/engine/recommend.ts';
import { W, relationWeight, type Evidence } from '../src/engine/relations.ts';
import { evalCond, verifiedTags } from '../src/engine/rules.ts';
import { matchArchetypes, needsScore, substitutes, teamFeatures } from '../src/engine/comp.ts';
import { matchHero, searchHeroes } from '../src/lib/search.ts';
import { TIER_MIN, laneTiers } from '../src/engine/tiers.ts';
import { LANES } from '../src/types.ts';

let bundle: Bundle;
let engine: Engine;
let hero: (name: string) => HeroData;

beforeAll(() => {
  bundle = JSON.parse(readFileSync(resolve(import.meta.dirname, '../public/data/bundle.json'), 'utf-8'));
  engine = makeEngine(bundle);
  hero = (name) => {
    const h = bundle.heroes.find((x) => x.name === name);
    if (!h) throw new Error(`数据包里没有英雄 ${name}`);
    return h;
  };
});

const fill = (d: DraftState, slot: Slot, name: string) => place(d, slot, hero(name).id);
const pick = (side: 'blue' | 'red', index: number): Slot => ({ side, kind: 'pick', index });
const ban = (side: 'blue' | 'red', index: number): Slot => ({ side, kind: 'ban', index });

describe('分路推断', () => {
  it('五个定位清晰的英雄各得其所', () => {
    const team = ['廉颇', '兰陵王', '貂蝉', '马可波罗', '蔡文姬'].map((n) => ({ hero: hero(n) }));
    const a = assignLanes(team);
    expect(new Set(a.lanes).size).toBe(5);
    expect(a.open).toEqual([]);
    expect(a.lanes[3]).toBe(4); // 马可波罗 → 发育路
    expect(a.lanes[2]).toBe(3); // 貂蝉 → 中路
  });

  it('手动锁定优先，其他人让路', () => {
    const team = [{ hero: hero('廉颇'), locked: 5 as const }, { hero: hero('蔡文姬') }];
    const a = assignLanes(team);
    expect(a.lanes[0]).toBe(5);
    expect(a.lanes[1]).not.toBe(5);
  });

  it('未选满时给出空缺分路', () => {
    const a = assignLanes([{ hero: hero('马可波罗') }]);
    expect(a.open).toHaveLength(4);
    expect(a.open).not.toContain(4);
  });

  it('已有射手时再选射手，适配度明显低于补空缺位置', () => {
    const team = [{ hero: hero('马可波罗') }];
    expect(laneFitFor(hero('后羿'), team).fit).toBeLessThan(laneFitFor(hero('蔡文姬'), team).fit);
  });

  it('指定位置时按该位置的适配度计算', () => {
    expect(laneFitFor(hero('马可波罗'), [], 4).fit).toBeGreaterThan(0.8);
    expect(laneFitFor(hero('马可波罗'), [], 5).fit).toBeLessThan(0.3);
  });
});

describe('BP规则', () => {
  it('排位顺序：先双方禁用，再按 1-2-2-2-2-1 选人', () => {
    const d = newDraft('ranked');
    const seq = sequence(d);
    expect(seq).toHaveLength(MODE_INFO.ranked.banPerSide * 2 + 10);
    expect(seq.slice(0, 10).every((s) => s.kind === 'ban')).toBe(true);
    expect(PICK_ORDER.map((s) => s.side[0]).join('')).toBe('brrbbrrbbr');
    expect(activeSlot(d)).toEqual(ban('blue', 0));
  });

  it('禁用位数量可调，设为0时直接进入选人', () => {
    const d = setBanCount(newDraft('ranked'), 0);
    expect(activeSlot(d)).toEqual(pick('blue', 0));
  });

  it('双方可以重复禁同一个英雄，同一方不能重复', () => {
    let d = newDraft('ranked');
    d = fill(d, ban('blue', 0), '盾山');
    expect(unavailableReason(d, hero('盾山'), ban('red', 0), engine.byId)).toBeNull();
    expect(unavailableReason(d, hero('盾山'), ban('blue', 1), engine.byId)).toBe('banned');
  });

  it('被禁和已选的英雄不能再选', () => {
    let d = newDraft('ranked');
    d = fill(d, ban('red', 0), '盾山');
    d = fill(d, pick('blue', 0), '貂蝉');
    expect(unavailableReason(d, hero('盾山'), pick('blue', 1), engine.byId)).toBe('banned');
    expect(unavailableReason(d, hero('貂蝉'), pick('red', 0), engine.byId)).toBe('picked');
    // 修改同一个槽位时，原来的英雄不算“已选”
    expect(unavailableReason(d, hero('貂蝉'), pick('blue', 0), engine.byId)).toBeNull();
  });

  it('多形态英雄互斥：选了一个形态后其余形态不可选', () => {
    const forms = bundle.heroes.filter((h) => h.groupId === 'yuanliuzhizi');
    expect(forms.length).toBeGreaterThanOrEqual(2);
    const d = place(newDraft('free'), pick('blue', 0), forms[0].id);
    expect(unavailableReason(d, forms[1], pick('red', 0), engine.byId)).toBe('group');
  });

  it('限时英雄在排位和巅峰赛不可用，自由模拟可用', () => {
    const limited = bundle.heroes.find((h) => h.isLimited)!;
    expect(limited).toBeTruthy();
    expect(unavailableReason(newDraft('ranked'), limited, pick('blue', 0), engine.byId)).toBe('limited');
    expect(unavailableReason(newDraft('peak'), limited, ban('blue', 0), engine.byId)).toBe('limited');
    expect(unavailableReason(newDraft('free'), limited, pick('blue', 0), engine.byId)).toBeNull();
  });

  it('手动选中的槽位优先于规则顺序；填入后回到规则顺序', () => {
    let d = newDraft('ranked');
    d = { ...d, cursor: pick('red', 3) };
    expect(activeSlot(d)).toEqual(pick('red', 3));
    d = fill(d, pick('red', 3), '貂蝉');
    expect(d.cursor).toBeNull();
    expect(activeSlot(d)).toEqual(ban('blue', 0));
  });

  it('同队只能有一人锁定某条路', () => {
    let d = newDraft('free');
    d = setLaneLock(d, 'blue', 0, 3);
    d = setLaneLock(d, 'blue', 1, 3);
    expect(d.laneLocks.blue[0]).toBeNull();
    expect(d.laneLocks.blue[1]).toBe(3);
  });

  it('按顺序填完20手后BP完成', () => {
    let d = newDraft('ranked');
    const pool = bundle.heroes.filter((h) => !h.isLimited && !h.groupId);
    let i = 0;
    for (;;) {
      const s = activeSlot(d);
      if (!s) break;
      let h = pool[i++];
      while (unavailableReason(d, h, s, engine.byId)) h = pool[i++];
      d = place(d, s, h.id);
    }
    expect(isComplete(d)).toBe(true);
  });
});

describe('关系与证据', () => {
  it('证据权重：官方为基准，互相印证有加成，规则和职业赛各有上限，总和封顶', () => {
    const official = (page: number): Evidence => ({ kind: 'official', page, text: 'x' });
    expect(relationWeight([official(1)])).toBe(W.official);
    expect(relationWeight([official(1), official(2)])).toBe(W.official + W.officialCorroborated);
    expect(relationWeight([{ kind: 'kpl', n: 100, expected: 1, lift: 100 }])).toBe(W.kplCap);
    const rule = bundle.rules[0];
    const many: Evidence[] = Array.from({ length: 5 }, () => ({ kind: 'rule' as const, rule: { ...rule, weight: 0.6 }, aId: 1, bId: 2, aTags: [], bTags: [], aNotes: [], bNotes: [] }));
    expect(relationWeight(many)).toBe(W.ruleCap);
    expect(relationWeight([official(1), official(2), ...many, { kind: 'kpl', n: 100, expected: 1, lift: 100 }])).toBeLessThanOrEqual(W.totalCap);
    expect(relationWeight([])).toBe(0);
  });

  it('官方关系方向正确：廉颇页面写被后羿压制 → 后羿克制廉颇', () => {
    const r = engine.rel.getCounter(hero('后羿').id, hero('廉颇').id);
    expect(r?.evidence.some((e) => e.kind === 'official')).toBe(true);
    expect(engine.rel.net(hero('后羿').id, hero('廉颇').id)).toBeGreaterThan(0);
  });

  it('所有关系指向存在的英雄，且不存在自指', () => {
    for (const r of engine.rel.all) {
      expect(engine.byId.has(r.a) && engine.byId.has(r.b)).toBe(true);
      expect(r.a).not.toBe(r.b);
    }
  });

  it('规则证据引用的原文片段逐字存在于对应技能', () => {
    const norm = (s: string) => s.replace(/\s+/g, '');
    let checked = 0;
    for (const r of engine.rel.all)
      for (const e of r.evidence) {
        if (e.kind !== 'rule') continue;
        for (const [id, tags] of [
          [e.aId, e.aTags],
          [e.bId, e.bTags],
        ] as const) {
          const h = engine.byId.get(id)!;
          for (const t of tags) {
            const skill = h.skills.find((s) => s.slot === t.slot)!;
            expect(norm(skill.desc)).toContain(norm(t.quote));
            expect(t.status).toBe('verified');
            checked++;
          }
        }
      }
    expect(checked).toBeGreaterThan(1000);
  });

  it('“没有某机制”的判断在档案不可用时不成立', () => {
    const h = hero('马可波罗');
    const names = (t: number) => String(t);
    const stale: HeroData = { ...h, profile: { ...h.profile!, status: 'needs_review' } };
    expect(evalCond(stale, { none: ['stealth'] }, names, String).ok).toBe(false);
    expect(verifiedTags(stale)).toEqual([]);
    const none: HeroData = { ...h, profile: null };
    expect(evalCond(none, { none: ['stealth'] }, names, String).ok).toBe(false);
    // 官方职业条件不依赖档案
    expect(evalCond(none, { heroType: [h.heroType] }, names, String).ok).toBe(true);
  });

  it('存疑标签不算已核实，但会阻止“没有某机制”的结论', () => {
    const h = hero('马可波罗');
    const withDisputed: HeroData = { ...h, profile: { ...h.profile!, tags: [...h.profile!.tags, { tag: 'stealth', slot: '1技能', quote: 'x', status: 'disputed' }] } };
    expect(verifiedTags(withDisputed, ['stealth'])).toEqual([]);
    expect(evalCond(withDisputed, { none: ['stealth'] }, String, String).ok).toBe(false);
  });

  it('盾山阻挡飞行物对射手的规则被触发，并带双方依据', () => {
    const r = engine.rel.getCounter(hero('盾山').id, hero('马可波罗').id);
    const e = r?.evidence.find((x) => x.kind === 'rule' && x.rule.id === 'block_vs_marksman');
    expect(e && e.kind === 'rule' && e.aTags.some((t) => t.tag === 'projectile_block')).toBe(true);
  });
});

describe('推荐评分', () => {
  const midDraft = () => {
    let d = setBanCount(newDraft('ranked'), 0);
    d = fill(d, pick('blue', 0), '马可波罗');
    d = fill(d, pick('red', 0), '貂蝉');
    d = fill(d, pick('red', 1), '廉颇');
    return d;
  };

  it('分数在0–100之间，各分项不超过上限，列表按分数降序（手工权重）', () => {
    const recs = recommendPicks(engine, midDraft(), { side: 'blue', mult: HAND_MULT });
    expect(recs.length).toBeGreaterThan(100);
    for (const r of recs) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      const v = (k: string) => r.parts.find((p) => p.key === k)?.value ?? 0;
      expect(Math.abs(v('counter'))).toBeLessThanOrEqual(DEFAULT_WEIGHTS.counterCap);
      expect(v('synergy')).toBeLessThanOrEqual(DEFAULT_WEIGHTS.synergyCap);
      expect(Math.abs(v('needs'))).toBeLessThanOrEqual(DEFAULT_WEIGHTS.needsCap);
      expect(v('exposure')).toBeLessThanOrEqual(0);
      expect(v('exposure')).toBeGreaterThanOrEqual(-DEFAULT_WEIGHTS.exposureCap);
    }
    for (let i = 1; i < recs.length; i++) expect(recs[i - 1].score).toBeGreaterThanOrEqual(recs[i].score);
  });

  it('不推荐已选、已禁、限时英雄', () => {
    let d = midDraft();
    d = setBanCount(d, 1);
    d = fill(d, ban('red', 0), '盾山');
    const ids = new Set(recommendPicks(engine, d, { side: 'blue' }).map((r) => r.hero.id));
    for (const n of ['马可波罗', '貂蝉', '廉颇', '盾山']) expect(ids.has(hero(n).id)).toBe(false);
    for (const h of bundle.heroes.filter((x) => x.isLimited)) expect(ids.has(h.id)).toBe(false);
  });

  it('已有射手时，另一个射手会因为没有位置而排在后面', () => {
    const recs = recommendPicks(engine, midDraft(), { side: 'blue' });
    const rank = (n: string) => recs.findIndex((r) => r.hero.name === n);
    expect(rank('后羿')).toBeGreaterThan(60);
    expect(recs.find((r) => r.hero.name === '后羿')!.parts.find((p) => p.key === 'lane')!.value).toBeLessThanOrEqual(DEFAULT_WEIGHTS.laneMiss);
  });

  it('选人模型：按阶段给出系数，克制和分路系数不低于1，系数非负', () => {
    expect(engine.model).not.toBeNull();
    expect(engine.model!.phases.length).toBe(3);
    for (const order of [1, 4, 9]) {
      const m = multFor(engine.model, order);
      expect(m.counter).toBeGreaterThanOrEqual(1);
      expect(m.lane).toBeGreaterThanOrEqual(1);
      for (const v of Object.values(m)) expect(v).toBeGreaterThanOrEqual(0);
    }
    expect(multFor(null, 1)).toBe(HAND_MULT);
  });

  it('选人模型：包含近60天选取和禁用优先级两个分项；指定位置时用专用系数且分路系数不低于下限', () => {
    const m = bundle.model!;
    expect(m.features).toEqual(expect.arrayContaining(['lanePickRecent', 'banPri']));
    expect(m.lanePhases?.length).toBe(3);
    for (const order of [1, 4, 8]) {
      const given = multFor(m, order, true);
      expect(given.lane).toBeGreaterThanOrEqual(m.floors.lane);
      expect(given.counter).toBeGreaterThanOrEqual(m.floors.counter);
      for (const v of Object.values(given)) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('选人模型：分数仍在0–100之间并按降序；职业赛分项带样本数说明', () => {
    const recs = recommendPicks(engine, midDraft(), { side: 'blue' });
    for (const r of recs) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
    for (let i = 1; i < recs.length; i++) expect(recs[i - 1].score).toBeGreaterThanOrEqual(recs[i].score);
    const lanePick = recs.flatMap((r) => [...(r.parts.find((p) => p.key === 'lanePick')?.items ?? []), ...(r.parts.find((p) => p.key === 'lanePickRecent')?.items ?? [])]);
    expect(lanePick.length).toBeGreaterThan(10);
    for (const i of lanePick) expect(i.text).toMatch(/队伍场次中有\d+次/);
    const pro = recs.flatMap((r) => [...(r.parts.find((p) => p.key === 'proVs')?.items ?? []), ...(r.parts.find((p) => p.key === 'proAlly')?.items ?? [])]);
    for (const i of pro) expect(i.text).toMatch(/被选了\d+次（按它的平均被选概率预计约[\d.]+次）/);
  });

  it('开局第一手指定位置时，不打这个位置的英雄排在后面', () => {
    const d = setBanCount(newDraft('ranked'), 0);
    const recs = recommendPicks(engine, d, { side: 'blue', wantLane: 4 });
    for (const r of recs.slice(0, 10)) expect(r.hero.lanes[3]).toBeGreaterThan(0.15);
  });

  it('英雄池模式只在池内推荐，熟练度高的加分更多', () => {
    const pool = [
      { id: hero('蔡文姬').id, level: 3 },
      { id: hero('张飞').id, level: 1 },
    ];
    const recs = recommendPicks(engine, midDraft(), { side: 'blue', pool });
    expect(recs.map((r) => r.hero.name).sort()).toEqual(['张飞', '蔡文姬'].sort());
    const poolPart = (n: string) => recs.find((r) => r.hero.name === n)!.parts.find((p) => p.key === 'pool')!.value;
    expect(poolPart('蔡文姬')).toBeGreaterThan(poolPart('张飞'));
  });

  it('指定位置后，推荐的英雄都能打这个位置', () => {
    const recs = recommendPicks(engine, midDraft(), { side: 'blue', wantLane: 5, limit: 10 });
    for (const r of recs) expect(r.hero.lanes[4]).toBeGreaterThanOrEqual(0.15);
  });

  it('可信程度：没有已选英雄时为低；覆盖数不超过已选英雄数', () => {
    const empty = recommendPicks(engine, setBanCount(newDraft('ranked'), 0), { side: 'blue', limit: 5 });
    for (const r of empty) expect(r.confidence).toBe('低');
    for (const r of recommendPicks(engine, midDraft(), { side: 'blue' })) {
      expect(r.coverage.total).toBe(3);
      expect(r.coverage.covered).toBeLessThanOrEqual(3);
      if (r.coverage.covered === 0) expect(r.confidence).toBe('低');
    }
  });

  it('克制对方已选英雄的候选在克制分项上得分为正', () => {
    // 盾山阻挡飞行物 → 对马可波罗有规则关系
    let d = setBanCount(newDraft('ranked'), 0);
    d = fill(d, pick('blue', 0), '马可波罗');
    const r = recommendPicks(engine, d, { side: 'red' }).find((x) => x.hero.name === '盾山')!;
    expect(r.parts.find((p) => p.key === 'counter')!.value).toBeGreaterThan(0);
  });

  it('对方已选满时不再计算先手暴露', () => {
    let d = setBanCount(newDraft('free'), 0);
    ['貂蝉', '廉颇', '后羿', '兰陵王', '蔡文姬'].forEach((n, i) => (d = fill(d, pick('red', i), n)));
    for (const r of recommendPicks(engine, d, { side: 'blue', limit: 20 })) expect(r.parts.find((p) => p.key === 'exposure')!.value).toBe(0);
  });

  it('相同输入得到相同结果', () => {
    const a = recommendPicks(engine, midDraft(), { side: 'blue', limit: 20 }).map((r) => `${r.hero.id}:${r.score}`);
    const b = recommendPicks(engine, midDraft(), { side: 'blue', limit: 20 }).map((r) => `${r.hero.id}:${r.score}`);
    expect(a).toEqual(b);
  });

  it('禁用推荐：不含已禁/已选/限时英雄；对方选满后为空', () => {
    let d = newDraft('ranked');
    d = fill(d, ban('blue', 0), '盾山');
    d = fill(d, pick('blue', 0), '马可波罗');
    const bans = recommendBans(engine, d, { side: 'blue' });
    expect(bans.length).toBeGreaterThan(5);
    const ids = new Set(bans.map((b) => b.hero.id));
    expect(ids.has(hero('盾山').id)).toBe(false);
    expect(ids.has(hero('马可波罗').id)).toBe(false);
    for (const h of bundle.heroes.filter((x) => x.isLimited)) expect(ids.has(h.id)).toBe(false);
    ['貂蝉', '廉颇', '后羿', '兰陵王', '蔡文姬'].forEach((n, i) => (d = fill(d, pick('red', i), n)));
    expect(recommendBans(engine, d, { side: 'blue' })).toEqual([]);
  });

  it('禁用推荐会优先考虑克制意向英雄的目标', () => {
    const d = newDraft('ranked');
    const intent = hero('马可波罗').id;
    const withIntent = recommendBans(engine, d, { side: 'blue', intents: [intent] });
    const dunshan = withIntent.find((b) => b.hero.name === '盾山')!;
    expect(dunshan.items.some((i) => i.text.includes('马可波罗'))).toBe(true);
  });
});

describe('阵容分析', () => {
  it('阵容特征统计与需求提示', () => {
    const team = ['马可波罗', '后羿', '兰陵王'].map(hero);
    const f = teamFeatures(team);
    expect(f.size).toBe(3);
    expect(f.frontline).toBe(0);
    const notes = needsScore(hero('廉颇'), team);
    expect(notes.some((n) => n.text.includes('坦克') && n.delta > 0)).toBe(true);
    // 前两手不提阵容缺口
    expect(needsScore(hero('廉颇'), [hero('马可波罗')])).toEqual([]);
  });

  it('战术体系按条件命中，不硬凑', () => {
    const tagName = (id: string) => id;
    const protect = matchArchetypes(['马可波罗', '蔡文姬', '盾山', '廉颇', '貂蝉'].map(hero), bundle.archetypes, tagName);
    for (const m of protect) for (const d of m.detail) expect(d.heroes.length).toBeGreaterThanOrEqual(d.count);
    expect(matchArchetypes([hero('马可波罗')], bundle.archetypes, tagName)).toEqual([]);
  });

  it('替代英雄来自同一分路且不含自身', () => {
    const subs = substitutes(hero('后羿'), bundle.heroes);
    for (const s of subs) {
      expect(s.hero.id).not.toBe(hero('后羿').id);
      expect(s.hero.lanes[3]).toBeGreaterThanOrEqual(0.5);
      expect(s.similarity).toBeGreaterThan(0);
    }
  });
});

describe('分路梯度', () => {
  it('职业赛梯度：按出场率降序，档位与下限一致，不含限时英雄', () => {
    const t = laneTiers(bundle)!;
    expect(t.games).toBeGreaterThanOrEqual(20);
    for (const lane of LANES) {
      const rows = t.rows[lane];
      expect(rows.length).toBeGreaterThan(3);
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (i > 0) expect(rows[i - 1].presence).toBeGreaterThanOrEqual(r.presence);
        expect(r.presence).toBeGreaterThanOrEqual(TIER_MIN[r.tier]);
        if (r.tier > 0) expect(r.presence).toBeLessThan(TIER_MIN[r.tier - 1]);
        expect(r.hero.isLimited).toBeFalsy();
      }
    }
  });

  it('营地英雄榜：每个段位每个位置都有数据，不超过公开接口的上限，数字原样在0–1之间', () => {
    const camp = bundle.camp!;
    expect(camp.segments.length).toBeGreaterThanOrEqual(2);
    const ids = new Set(bundle.heroes.map((h) => h.id));
    for (const s of camp.segments) {
      for (const lane of LANES) {
        const list = s.lanes[lane];
        expect(list.length).toBeGreaterThanOrEqual(5);
        expect(list.length).toBeLessThanOrEqual(camp.limit);
        for (const e of list) {
          expect(ids.has(e.id)).toBe(true);
          expect(e.tier).toMatch(/^T\d$/);
          for (const x of [e.win, e.show, e.ban]) expect(x >= 0 && x <= 1).toBe(true);
        }
      }
    }
  });

  it('营地数据不参与推荐计分：去掉后推荐结果不变', () => {
    const d = fill(fill(setBanCount(newDraft('ranked'), 0), pick('red', 0), '后羿'), pick('blue', 0), '廉颇');
    const a = recommendPicks(engine, d, { side: 'blue' }).slice(0, 10).map((r) => [r.hero.id, r.score]);
    const b = recommendPicks(makeEngine({ ...bundle, camp: null }), d, { side: 'blue' }).slice(0, 10).map((r) => [r.hero.id, r.score]);
    expect(b).toEqual(a);
  });
});

describe('搜索', () => {
  it('支持中文名、拼音、首字母和外号', () => {
    expect(searchHeroes(bundle.heroes, '猴子')[0].name).toBe('孙悟空');
    expect(searchHeroes(bundle.heroes, 'lbqh')[0].name).toBe('鲁班七号');
    expect(searchHeroes(bundle.heroes, 'diaochan')[0].name).toBe('貂蝉');
    expect(searchHeroes(bundle.heroes, '貂蝉')[0].name).toBe('貂蝉');
    expect(matchHero(hero('貂蝉'), 'zzzz')).toBeNull();
    expect(searchHeroes(bundle.heroes, '')).toHaveLength(bundle.heroes.length);
  });
});

describe('数据新鲜度提示', () => {
  it('14天内不提示，超过14天提示，超过30天强提示', async () => {
    const { freshness } = await import('../src/lib/data.ts');
    const now = Date.parse('2026-12-31T00:00:00Z');
    const daysAgo = (n: number) => new Date(now - n * 86400_000).toISOString();
    expect(freshness(daysAgo(0), now).level).toBe('fresh');
    expect(freshness(daysAgo(14), now).level).toBe('fresh');
    expect(freshness(daysAgo(15), now)).toEqual({ days: 15, level: 'stale' });
    expect(freshness(daysAgo(30), now).level).toBe('stale');
    expect(freshness(daysAgo(31), now).level).toBe('old');
  });
});
