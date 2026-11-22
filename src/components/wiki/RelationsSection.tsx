// 克制与配合关系：克制谁 / 被谁克制 / 配合。按计分权重降序，可展开查看完整证据。
import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { HeroData, Scene } from '../../types.ts';
import type { Evidence, Relation } from '../../engine/relations.ts';
import { useEngine } from '../../lib/data.ts';
import { EvidenceList, KindBadge, KindBadges } from '../Evidence.tsx';
import { HeroAvatar, Segmented } from '../ui.tsx';
import { WikiSection } from './WikiSection.tsx';

type KindFilter = 'all' | 'official' | 'rule' | 'kpl';
type SceneFilter = 'all' | Scene;

const KIND_OPTIONS: { value: KindFilter; label: string; title: string }[] = [
  { value: 'all', label: '全部', title: '全部证据类型' },
  { value: 'official', label: '官方', title: '官方英雄页面的关系说明' },
  { value: 'rule', label: '机制', title: '由双方技能原文按规则推导的机制倾向' },
  { value: 'kpl', label: '职业赛', title: '职业赛同队共现（只出现在配合关系中）' },
];
const SCENES: Scene[] = ['对线', '团战', '前期', '后期', '全局'];
const DEFAULT_SHOWN = 8;
const otherB = (r: Relation) => r.b;
const otherA = (r: Relation) => r.a;

const kinds = (es: Evidence[]) => new Set(es.map((e) => e.kind));

function matches(r: Relation, kind: KindFilter, scene: SceneFilter) {
  if (kind !== 'all') {
    const pool = r.weight > 0 ? r.evidence : [...r.evidence, ...r.doubtful];
    if (!kinds(pool).has(kind)) return false;
  }
  if (scene !== 'all' && !r.scenes.includes(scene)) return false;
  return true;
}

function RelationRow({ relation, other, tone }: { relation: Relation; other: HeroData; tone: 'bad' | 'good' }) {
  const [open, setOpen] = useState(false);
  const doubtfulOnly = relation.weight === 0;
  const doubtfulKinds = [...kinds(relation.doubtful)];
  return (
    <li className={`rounded-lg border transition-colors ${open ? 'border-line2 bg-panel2/70' : 'border-transparent hover:border-line hover:bg-panel2/50'}`}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Link to={`/heroes/${other.id}`} className="flex min-w-0 shrink-0 items-center gap-2 rounded hover:text-blue" title={`查看${other.name}`}>
          <HeroAvatar hero={other} size={30} />
          <span className="w-[5.5em] truncate text-[13.5px] font-medium">{other.name}</span>
        </Link>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1.5 rounded py-1 text-left" title={open ? '收起证据' : '展开查看完整证据'}>
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {doubtfulOnly ? (
              doubtfulKinds.map((k) => <KindBadge key={k} kind={k} />)
            ) : (
              <KindBadges relation={relation} />
            )}
            {relation.scenes.map((s) => (
              <span key={s} className="inline-flex h-[18px] items-center rounded border border-line px-1 text-[11px] text-mute">
                {s}
              </span>
            ))}
          </span>
          {!doubtfulOnly && (
            <span className={`shrink-0 text-[11px] ${tone === 'bad' ? 'text-bad/80' : 'text-good/80'}`} title="计分权重：由证据类型与数量决定，不是胜率">
              权重{+relation.weight.toFixed(2)}
            </span>
          )}
          <span className={`shrink-0 text-[11px] text-dim transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
        </button>
      </div>
      {open && (
        <div className="border-t border-line px-3 pb-3 pt-2.5">
          <EvidenceList relation={relation} />
        </div>
      )}
    </li>
  );
}

function RelationGroup({ title, desc, tone, relations, otherOf, kind, scene }: { title: string; desc: string; tone: 'bad' | 'good'; relations: Relation[]; otherOf: (r: Relation) => number; kind: KindFilter; scene: SceneFilter }) {
  const { byId } = useEngine();
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => relations.map((r) => ({ r, h: byId.get(otherOf(r)) })).filter((x): x is { r: Relation; h: HeroData } => !!x.h), [relations, byId, otherOf]);
  const visible = rows.filter((x) => matches(x.r, kind, scene));
  const scored = visible.filter((x) => x.r.weight > 0).sort((a, b) => b.r.weight - a.r.weight || a.h.pinyin.localeCompare(b.h.pinyin));
  const doubtful = visible.filter((x) => x.r.weight === 0).sort((a, b) => a.h.pinyin.localeCompare(b.h.pinyin));
  const totalScored = rows.filter((x) => x.r.weight > 0).length;
  const filtered = kind !== 'all' || scene !== 'all';
  const shown = showAll ? scored : scored.slice(0, DEFAULT_SHOWN);

  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-line bg-panel2/30">
      <div className="border-b border-line px-3.5 py-2.5">
        <div className="flex items-baseline gap-2">
          <h3 className={`text-[14px] font-semibold ${tone === 'bad' ? 'text-bad' : 'text-good'}`}>{title}</h3>
          <span className="text-[12px] text-mute">
            {filtered ? `${scored.length} / ${totalScored}条` : `${totalScored}条`}
          </span>
        </div>
        <p className="mt-0.5 text-[11.5px] text-dim">{desc}</p>
      </div>
      <div className="p-1.5">
        {scored.length === 0 ? (
          <div className="px-2 py-5 text-center text-[13px] text-mute">暂无结论{filtered && totalScored > 0 && <span className="text-dim">（当前筛选下）</span>}</div>
        ) : (
          <ul className="space-y-0.5">
            {shown.map(({ r, h }) => (
              <RelationRow key={`${r.type}-${r.a}-${r.b}`} relation={r} other={h} tone={tone} />
            ))}
          </ul>
        )}
        {scored.length > DEFAULT_SHOWN && (
          <button type="button" className="btn btn-ghost btn-sm mt-1 w-full" onClick={() => setShowAll(!showAll)}>
            {showAll ? '收起' : `显示全部${scored.length}条`}
          </button>
        )}
        {doubtful.length > 0 && (
          <details className="group mt-1.5 rounded-lg border border-dashed border-line2">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] text-warn hover:bg-panel2/60">
              <span className="text-[11px] text-dim transition-transform group-open:rotate-90">▸</span>
              存疑（不计分）
              <span className="text-mute">{doubtful.length}条</span>
              <span className="ml-auto text-[11px] text-dim">证据可能过期或未核实</span>
            </summary>
            <ul className="space-y-0.5 p-1.5 pt-0">
              {doubtful.map(({ r, h }) => (
                <RelationRow key={`${r.type}-${r.a}-${r.b}`} relation={r} other={h} tone={tone} />
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

export function RelationsSection({ hero }: { hero: HeroData }) {
  const { rel } = useEngine();
  const [params, setParams] = useSearchParams();
  const kindParam = params.get('ev');
  const kind: KindFilter = KIND_OPTIONS.some((o) => o.value === kindParam) ? (kindParam as KindFilter) : 'all';
  const sceneParam = params.get('scene');
  const scene: SceneFilter = SCENES.includes(sceneParam as Scene) ? (sceneParam as Scene) : 'all';

  const setParam = (k: string, v: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v === 'all') next.delete(k);
        else next.set(k, v);
        return next;
      },
      { replace: true },
    );

  const id = hero.id;
  const counters = rel.counters(id);
  const counteredBy = rel.counteredBy(id);
  const synergies = rel.synergies(id);
  const otherSyn = useCallback((r: Relation) => (r.a === id ? r.b : r.a), [id]);

  return (
    <WikiSection
      id="relations"
      title="克制与配合关系"
      note="按计分权重从高到低排列，点击一行展开完整证据"
      extra={
        <Link to={`/graph?hero=${id}`} className="btn btn-sm">
          在图谱中查看
        </Link>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-mute">证据类型</span>
          <Segmented value={kind} options={KIND_OPTIONS} onChange={(v) => setParam('ev', v)} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-mute">场景</span>
          <Segmented value={scene} options={[{ value: 'all' as SceneFilter, label: '全部' }, ...SCENES.map((s) => ({ value: s as SceneFilter, label: s }))]} onChange={(v) => setParam('scene', v)} />
        </div>
        <p className="ml-auto text-[11.5px] text-dim">官方＝官方英雄页面的关系说明；机制＝由双方技能原文按规则推导的倾向；职业赛＝职业赛同队共现，不代表胜率</p>
      </div>
      <div className="grid grid-cols-3 items-start gap-3">
        <RelationGroup title="克制谁" desc={`${hero.name}克制以下英雄`} tone="bad" relations={counters} otherOf={otherB} kind={kind} scene={scene} />
        <RelationGroup title="被谁克制" desc={`以下英雄克制${hero.name}`} tone="bad" relations={counteredBy} otherOf={otherA} kind={kind} scene={scene} />
        <RelationGroup title="配合" desc={`与${hero.name}存在配合关系的英雄`} tone="good" relations={synergies} otherOf={otherSyn} kind={kind} scene={scene} />
      </div>
    </WikiSection>
  );
}
