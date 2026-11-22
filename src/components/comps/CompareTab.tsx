// 阵容对比：两套阵容的分析要点逐项对齐，以及双方之间逐对计算的克制关系。
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { HeroData } from '../../types.ts';
import { useEngine } from '../../lib/data.ts';
import { compKey, useUser } from '../../lib/userStore.ts';
import type { Relation } from '../../engine/relations.ts';
import { KindBadges, RelationCard } from '../Evidence.tsx';
import { Empty, HeroAvatar, LaneBadge } from '../ui.tsx';
import { CompAnalysis } from './CompAnalysis.tsx';
import { PlaybookView } from '../play/PlaybookView.tsx';
import { Segmented } from '../ui.tsx';
import { DAMAGE_NAME, FEATURES, LOW_FIT, summarize, type CompSummary } from './analysis.ts';
import { Note, Toggle, graphLink, parseIds, resolveHeroes, sameGroup, useProComps, useTagName } from './shared.tsx';
import type { ParamPatch } from './shared.tsx';

interface Option {
  ref: string;
  label: string;
  group: string;
}

interface Resolved {
  ref: string;
  label: string;
  heroes: HeroData[];
  missing: number[];
  error: string | null;
}

const heroNames = (byId: Map<number, HeroData>, ids: number[]) => ids.flatMap((id) => byId.get(id)?.name ?? []).join(' ') || '没有有效英雄';

function useOptions(): Option[] {
  const { byId } = useEngine();
  const custom = useUser((s) => s.customComps);
  const favs = useUser((s) => s.favoriteComps);
  const pro = useProComps();
  return useMemo(() => {
    const out: Option[] = [];
    for (const c of custom) if (c.heroes.some((id) => byId.has(id))) out.push({ ref: `my:${c.id}`, label: `${c.name || '未命名阵容'}（${heroNames(byId, c.heroes)}）`, group: '我的阵容' });
    for (const k of favs) if (parseIds(k).some((id) => byId.has(id))) out.push({ ref: `fav:${k}`, label: heroNames(byId, parseIds(k)), group: '已收藏阵容' });
    for (const c of pro ?? []) out.push({ ref: `pro:${c.key}`, label: `${heroNames(byId, c.ids)} · 出现${c.n}次`, group: c.kind === 'lineup' ? '职业赛完整阵容' : '职业赛三人组合' });
    return out;
  }, [custom, favs, pro, byId]);
}

function useResolve(ref: string | null): Resolved | null {
  const { byId } = useEngine();
  const custom = useUser((s) => s.customComps);
  return useMemo(() => {
    if (!ref) return null;
    if (ref.startsWith('my:')) {
      const c = custom.find((x) => x.id === ref.slice(3));
      if (!c) return { ref, label: '自定义阵容', heroes: [], missing: [], error: '这个自定义阵容不存在（可能已删除或不在当前浏览器中）' };
      const r = resolveHeroes(byId, c.heroes);
      return { ref, label: c.name || '未命名阵容', ...r, error: r.heroes.length ? null : '这个阵容还没有英雄' };
    }
    const ids = parseIds(ref.replace(/^(pro|fav):/, ''));
    const r = resolveHeroes(byId, ids);
    return { ref, label: heroNames(byId, r.heroes.map((h) => h.id)), ...r, error: r.heroes.length ? null : '链接里没有有效的英雄ID' };
  }, [ref, custom, byId]);
}

function Picker({ side, value, options, onChange }: { side: 'A' | 'B'; value: string | null; options: Option[]; onChange: (ref: string | null) => void }) {
  const groups = [...new Set(options.map((o) => o.group))];
  const known = value != null && options.some((o) => o.ref === value);
  return (
    <label className="block">
      <span className={`mb-1 block text-[12px] font-medium ${side === 'A' ? 'text-blue' : 'text-red'}`}>阵容{side}（{side === 'A' ? '蓝方' : '红方'}）</span>
      <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">选择阵容…</option>
        {value && !known && <option value={value}>链接带入的阵容</option>}
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {options
              .filter((o) => o.group === g)
              .map((o) => (
                <option key={o.ref} value={o.ref}>
                  {o.label}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

export function CompareTab({ params, update }: { params: URLSearchParams; update: (p: ParamPatch, replace?: boolean) => void }) {
  const options = useOptions();
  const aRef = params.get('a');
  const bRef = params.get('b');
  const A = useResolve(aRef);
  const B = useResolve(bRef);

  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3">
          <Picker side="A" value={aRef} options={options} onChange={(r) => update({ a: r }, true)} />
          <button type="button" className="btn mb-0.5" disabled={!aRef && !bRef} onClick={() => update({ a: bRef, b: aRef }, true)} title="交换A和B">
            ⇄ 交换
          </button>
          <Picker side="B" value={bRef} options={options} onChange={(r) => update({ b: r }, true)} />
        </div>
        <p className="mt-2 text-[12px] text-mute">可选：我的阵容、已收藏阵容、职业赛阵容。也可以用链接参数带入，例如 a=英雄ID-英雄ID-…。</p>
        {options.length === 0 && <p className="mt-1 text-[12px] text-warn">当前没有可选的阵容：先在“我的阵容”里新建，或收藏职业赛阵容。</p>}
      </section>

      {A?.error && <Note tone="warn">阵容A：{A.error}</Note>}
      {B?.error && <Note tone="warn">阵容B：{B.error}</Note>}

      {A && B && !A.error && !B.error ? <Comparison A={A} B={B} /> : <Empty>选择两套阵容后在这里对比。</Empty>}
    </div>
  );
}

function Comparison({ A, B }: { A: Resolved; B: Resolved }) {
  const { bundle, rel } = useEngine();
  const tagName = useTagName();
  const sa = useMemo(() => summarize(A.heroes, bundle.archetypes, tagName), [A, bundle]);
  const sb = useMemo(() => summarize(B.heroes, bundle.archetypes, tagName), [B, bundle]);
  const [full, setFull] = useState(false);
  const [view, setView] = useState<'A' | 'B'>('A');

  const overlap = A.heroes.filter((h) => B.heroes.some((x) => x.id === h.id || sameGroup(x, h)));
  const { aOver, bOver, total } = useMemo(() => {
    const aOver: CounterPair[] = [];
    const bOver: CounterPair[] = [];
    let total = 0;
    for (const a of A.heroes)
      for (const b of B.heroes) {
        if (a.id === b.id || sameGroup(a, b)) continue;
        total++;
        const n = rel.net(a.id, b.id);
        if (n > 0) aOver.push({ x: a, y: b, net: +n.toFixed(2), r: rel.getCounter(a.id, b.id), back: rel.getCounter(b.id, a.id) });
        else if (n < 0) bOver.push({ x: b, y: a, net: +(-n).toFixed(2), r: rel.getCounter(b.id, a.id), back: rel.getCounter(a.id, b.id) });
      }
    aOver.sort((p, q) => q.net - p.net);
    bOver.sort((p, q) => q.net - p.net);
    return { aOver, bOver, total };
  }, [A, B, rel]);

  const aIds = A.heroes.map((h) => h.id);
  const bIds = B.heroes.map((h) => h.id);
  const sum = (l: CounterPair[]) => +l.reduce((s, p) => s + p.net, 0).toFixed(2);

  return (
    <div className="space-y-4">
      {compKey(aIds) === compKey(bIds) && <Note tone="warn">两边是同一套阵容。</Note>}
      {overlap.length > 0 && compKey(aIds) !== compKey(bIds) && (
        <Note tone="warn">两边有{overlap.length}个相同英雄（或同一英雄的不同形态）：{overlap.map((h) => h.name).join('、')}。实际对局中不会同时出现，这些英雄之间不计算克制关系。</Note>
      )}

      <section className="panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="panel-title">分析要点对比</h2>
          <Link className="btn btn-sm" to={graphLink(aIds, bIds)}>
            在图谱中查看对阵
          </Link>
        </div>
        <div className="overflow-hidden rounded-md border border-line">
          <table className="w-full table-fixed text-[12.5px]">
            <colgroup>
              <col className="w-[110px]" />
              <col />
              <col />
            </colgroup>
            <thead>
              <tr className="border-b border-line bg-panel2/60">
                <th className="px-3 py-2 text-left font-medium text-mute">项目</th>
                <th className="px-3 py-2 text-left font-medium text-blue">A · {A.label}</th>
                <th className="px-3 py-2 text-left font-medium text-red">B · {B.label}</th>
              </tr>
            </thead>
            <tbody>
              <Row label="英雄与分路" a={<LaneCell s={sa} />} b={<LaneCell s={sb} />} />
              <Row label="伤害构成" a={<DamageCell s={sa} />} b={<DamageCell s={sb} />} />
              {FEATURES.map((f) => (
                <Row key={f.key} label={f.label} title={`判定：${f.how(tagName)}`} a={<FeatureCell s={sa} k={f.key} needsProfile={f.needsProfile} />} b={<FeatureCell s={sb} k={f.key} needsProfile={f.needsProfile} />} />
              ))}
              <Row label="缺口" a={<GapCell s={sa} />} b={<GapCell s={sb} />} />
              <Row label="命中的体系" a={<ArchCell s={sa} />} b={<ArchCell s={sb} />} />
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11.5px] text-dim">各项判定方法与“阵容分析”相同（鼠标悬停项目名可查看）；只是“有没有”的计数，不是评分。</p>
      </section>

      <section className="panel p-4">
        <h2 className="panel-title">双方克制关系</h2>
        <p className="mt-0.5 text-[12px] text-mute">
          对A、B两边英雄逐对计算净克制权重（某方克制另一方的权重减去反向权重），只列出净权重为正的一方。共{total}对，其中{aOver.length + bOver.length}对有净克制，其余{total - aOver.length - bOver.length}对暂无结论或双向抵消。权重是证据计分，不是胜率。
        </p>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <CounterList title="A克制B" tone="text-blue" pairs={aOver} sum={sum(aOver)} />
          <CounterList title="B克制A" tone="text-red" pairs={bOver} sum={sum(bOver)} />
        </div>
      </section>

      <section className="panel p-4" id="compare-play">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="panel-title">对阵打法</h2>
            <p className="mt-0.5 text-[12px] text-mute">站在其中一方的角度：这一局怎么打、对面的突破口、要防的点、出装针对和分路对位。</p>
          </div>
          <Segmented<'A' | 'B'>
            value={view}
            onChange={setView}
            options={[
              { value: 'A', label: <span className="text-blue">我是A</span> },
              { value: 'B', label: <span className="text-red">我是B</span> },
            ]}
          />
        </div>
        {overlap.length > 0 ? <Note tone="warn">两边有相同英雄，实际对局中不会出现，不给出对阵打法。</Note> : <PlaybookView key={view} ally={view === 'A' ? A.heroes : B.heroes} enemy={view === 'A' ? B.heroes : A.heroes} />}
      </section>

      <section className="panel p-4">
        <div className="flex items-center justify-between">
          <h2 className="panel-title">完整阵容分析</h2>
          <Toggle open={full} onClick={() => setFull(!full)}>
            {full ? '收起' : '展开两边的完整阵容分析'}
          </Toggle>
        </div>
        {full && (
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <div className="mb-2 text-[13px] font-medium text-blue">A · {A.label}</div>
              <CompAnalysis heroIds={aIds} />
            </div>
            <div>
              <div className="mb-2 text-[13px] font-medium text-red">B · {B.label}</div>
              <CompAnalysis heroIds={bIds} />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

interface CounterPair {
  x: HeroData;
  y: HeroData;
  net: number;
  r: Relation | undefined;
  back: Relation | undefined;
}

function Row({ label, a, b, title }: { label: string; a: ReactNode; b: ReactNode; title?: string }) {
  return (
    <tr className="border-b border-line align-top last:border-b-0">
      <th className="bg-panel2/40 px-3 py-2 text-left font-medium text-sub" title={title}>
        {label}
      </th>
      <td className="border-r border-line px-3 py-2">{a}</td>
      <td className="px-3 py-2">{b}</td>
    </tr>
  );
}

function LaneCell({ s }: { s: CompSummary }) {
  const rows = [...s.lanes].sort((x, y) => x.lane - y.lane);
  return (
    <div className="flex flex-wrap gap-1.5">
      {rows.map((r) => (
        <span key={r.hero.id} className="inline-flex flex-col items-center gap-0.5" title={`${r.hero.name} · 适配${r.fit.toFixed(2)}`}>
          <HeroAvatar hero={r.hero} size={30} ring={r.fit < LOW_FIT ? 'var(--color-warn)' : undefined} />
          <LaneBadge lane={r.lane} />
        </span>
      ))}
      {s.lowFit.length > 0 && <span className="w-full text-[11.5px] text-warn">{s.lowFit.map((r) => r.hero.name).join('、')}不在常规分路（黄框）</span>}
    </div>
  );
}

function DamageCell({ s }: { s: CompSummary }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {(['physical', 'magic', 'mixed'] as const).map((k) => (
        <span key={k} className="inline-flex items-center gap-1">
          <span className="text-sub">
            {DAMAGE_NAME[k]} <b className="text-ink">{s.damage[k].length}</b>
          </span>
          {s.damage[k].map((h) => (
            <HeroAvatar key={h.id} hero={h} size={16} />
          ))}
        </span>
      ))}
    </div>
  );
}

function FeatureCell({ s, k, needsProfile }: { s: CompSummary; k: (typeof FEATURES)[number]['key']; needsProfile: boolean }) {
  const list = s.byFeature[k];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <b className={list.length ? 'text-ink' : 'text-mute'}>{list.length}</b>
      {list.map((h) => (
        <span key={h.id} className="inline-flex items-center gap-1 text-sub">
          <HeroAvatar hero={h} size={16} />
          {h.name}
        </span>
      ))}
      {needsProfile && s.features.unknown > 0 && <span className="text-[11.5px] text-warn">另有{s.features.unknown}人档案不可用</span>}
    </div>
  );
}

function GapCell({ s }: { s: CompSummary }) {
  if (s.heroes.length < 3) return <span className="text-mute">不足3人，不判断</span>;
  if (!s.gaps.length) return <span className="text-mute">未发现前排、伤害类型、硬控方面的缺口</span>;
  return (
    <ul className="space-y-0.5">
      {s.gaps.map((g, i) => (
        <li key={i} className={g.tone === 'bad' ? 'text-bad' : 'text-warn'}>
          {g.text}
        </li>
      ))}
    </ul>
  );
}

function ArchCell({ s }: { s: CompSummary }) {
  if (!s.matches.length) return <span className="text-mute">没有命中已定义的体系</span>;
  return (
    <div className="space-y-1">
      {s.matches.map((m) => (
        <div key={m.archetype.id} className="flex flex-wrap items-center gap-1.5">
          <Link to={`/comps?tab=archetypes&arch=${m.archetype.id}`} className="chip hover:text-ink">
            {m.archetype.name}
          </Link>
          {m.cores.map((h) => (
            <HeroAvatar key={h.id} hero={h} size={16} />
          ))}
        </div>
      ))}
    </div>
  );
}

function CounterList({ title, tone, pairs, sum }: { title: string; tone: string; pairs: CounterPair[]; sum: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? pairs : pairs.slice(0, 8);
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className={`text-[13.5px] font-semibold ${tone}`}>{title}</h3>
        <span className="text-[12px] text-mute">
          {pairs.length}对 · 净权重合计 {sum}
        </span>
      </div>
      {pairs.length === 0 ? (
        <Empty>暂无结论</Empty>
      ) : (
        <div className="space-y-1.5">
          {shown.map((p) => (
            <CounterRow key={`${p.x.id}-${p.y.id}`} p={p} />
          ))}
          {pairs.length > 8 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll(!all)}>
              {all ? '收起' : `显示全部${pairs.length}对`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CounterRow({ p }: { p: CounterPair }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-line bg-panel2/40">
      <button type="button" className="flex w-full flex-wrap items-center gap-2 px-2.5 py-1.5 text-left hover:bg-panel2" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={`inline-block text-mute transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
        <span className="inline-flex items-center gap-1 text-[12.5px]">
          <HeroAvatar hero={p.x} size={20} />
          {p.x.name}
        </span>
        <span className="text-[12px] text-bad">克制</span>
        <span className="inline-flex items-center gap-1 text-[12.5px]">
          <HeroAvatar hero={p.y} size={20} />
          {p.y.name}
        </span>
        {p.r && <KindBadges relation={p.r} />}
        <span className="ml-auto text-[12px] text-mute">净权重 {p.net}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-line px-3 py-2.5">
          {p.r && <RelationCard relation={p.r} />}
          {p.back && (p.back.evidence.length > 0 || p.back.doubtful.length > 0) && (
            <div>
              <p className="mb-1 text-[12px] text-mute">反向关系（权重{p.back.weight}，已从净权重中扣除）：</p>
              <RelationCard relation={p.back} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
