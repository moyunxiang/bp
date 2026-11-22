// 关系图谱 · 单英雄模式（/graph?hero=ID）。
// URL 参数：hero 中心英雄；kind 证据类型（official/rule/kpl）；scene 场景；n 每扇区数量。
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Evidence, Relation } from '../../engine/relations.ts';
import { useEngine } from '../../lib/data.ts';
import { EgoGraph } from '../EgoGraph.tsx';
import { Empty, HeroAvatar, Segmented, TypeBadge } from '../ui.tsx';
import { doubtfulOnlyCount, egoSectors, SECTOR_COLOR, SECTOR_HINT, SECTOR_LABEL } from './egoData.ts';
import { SECTOR_IDS } from './egoLayout.ts';
import { HeroPicker } from './HeroPicker.tsx';
import { RelationDetail, RelationRow, ShowMore } from './RelationPanel.tsx';
import { parseScene, SCENE_OPTIONS } from './shared.ts';

export type ParamPatch = Record<string, string | null>;
export type UpdateParams = (patch: ParamPatch, push?: boolean) => void;

type KindOpt = '' | 'official' | 'rule' | 'kpl';
const KIND_OPTIONS: { value: KindOpt; label: string; title?: string }[] = [
  { value: '', label: '全部' },
  { value: 'official', label: '官方', title: '官方英雄页面的关系说明' },
  { value: 'rule', label: '机制', title: '由双方技能原文按规则推导的机制倾向' },
  { value: 'kpl', label: '职业赛', title: '职业赛同队共现（只有配合关系）' },
];
const N_OPTIONS = [6, 8, 10, 16] as const;
const DEFAULT_N = 8;
const PATH_MAX = 8;

const TEXT_COLOR: Record<'bad' | 'warn' | 'good', string> = { bad: 'text-bad', warn: 'text-warn', good: 'text-good' };

export function EgoMode({ params, update }: { params: URLSearchParams; update: UpdateParams }) {
  const engine = useEngine();
  const heroParam = params.get('hero');
  const hero = heroParam && /^\d+$/.test(heroParam) ? (engine.byId.get(Number(heroParam)) ?? null) : null;
  const badParam = heroParam != null && heroParam !== '' && !hero;

  const kindParam = params.get('kind');
  const kind: KindOpt = kindParam === 'official' || kindParam === 'rule' || kindParam === 'kpl' ? kindParam : '';
  const scene = parseScene(params.get('scene'));
  const nParam = Number(params.get('n'));
  const n = (N_OPTIONS as readonly number[]).includes(nParam) ? nParam : DEFAULT_N;
  const kinds = useMemo<Evidence['kind'][] | null>(() => (kind ? [kind] : null), [kind]);

  // 探索路径与选中关系：中心英雄变化时调整（渲染期间根据上一次的值更新状态）
  const heroId = hero?.id ?? null;
  const [path, setPath] = useState<number[]>(heroId != null ? [heroId] : []);
  const [prevHero, setPrevHero] = useState<number | null>(heroId);
  const [selected, setSelected] = useState<Relation | null>(null);
  if (heroId !== prevHero) {
    setPrevHero(heroId);
    setSelected(null);
    if (heroId != null) setPath((p) => (p.includes(heroId) ? p : [...p, heroId].slice(-PATH_MAX)));
  }

  const setCenter = (id: number) => update({ hero: String(id) }, true);

  return (
    <div className="space-y-3">
      <div className="panel flex flex-wrap items-center gap-x-5 gap-y-3 p-3">
        <HeroPicker className="w-[300px]" onPick={(h) => setCenter(h.id)} placeholder="搜索英雄作为中心：中文名、拼音、首字母" />
        <FilterGroup label="证据">
          <Segmented value={kind} options={KIND_OPTIONS} onChange={(v) => update({ kind: v || null })} />
        </FilterGroup>
        <FilterGroup label="场景">
          <Segmented
            value={scene ?? ''}
            options={SCENE_OPTIONS.map((o) => ({ ...o, title: o.value ? `只显示适用于${o.value}或全局的关系` : undefined }))}
            onChange={(v) => update({ scene: v || null })}
          />
        </FilterGroup>
        <FilterGroup label="每个扇区">
          <Segmented value={n} options={N_OPTIONS.map((x) => ({ value: x, label: `${x}个` }))} onChange={(v) => update({ n: v === DEFAULT_N ? null : String(v) })} />
        </FilterGroup>
      </div>

      {badParam && (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-2.5 text-[13px] text-warn">链接里的英雄ID“{heroParam}”不存在（可能已改版或输入有误），请重新选择英雄。</div>
      )}

      {!hero ? (
        <EgoGuide onPick={setCenter} />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_400px] items-start gap-4">
          <section className="panel min-w-0 p-4">
            <Breadcrumbs path={path} current={hero.id} onGo={setCenter} onClear={() => setPath([hero.id])} />
            <EgoGraph
              heroId={hero.id}
              perSector={n}
              kinds={kinds}
              scene={scene}
              selected={selected}
              onSelect={setSelected}
              onCenter={setCenter}
              fitHeight="calc(100vh - 250px)"
              className="mt-2"
            />
          </section>
          <aside className="sticky top-16 max-h-[calc(100vh-80px)] space-y-3 overflow-y-auto">
            {selected ? (
              <SelectedPanel relation={selected} centerId={hero.id} onClose={() => setSelected(null)} onCenter={setCenter} />
            ) : (
              <CenterPanel key={`${hero.id}-${kind}-${scene ?? ''}`} heroId={hero.id} kinds={kinds} scene={scene} n={n} onSelect={setSelected} />
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-mute">{label}</span>
      {children}
    </div>
  );
}

function Breadcrumbs({ path, current, onGo, onClear }: { path: number[]; current: number; onGo: (id: number) => void; onClear: () => void }) {
  const engine = useEngine();
  const heroes = path.map((id) => engine.byId.get(id)).filter((h) => h != null);
  return (
    <nav className="flex flex-wrap items-center gap-1 text-[12.5px]" aria-label="探索路径">
      <span className="mr-1 text-[12px] text-mute">探索路径</span>
      {heroes.map((h, i) => (
        <span key={h.id} className="flex items-center gap-1">
          {i > 0 && <span className="text-dim">›</span>}
          <button
            type="button"
            onClick={() => onGo(h.id)}
            aria-current={h.id === current ? 'page' : undefined}
            className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors ${h.id === current ? 'bg-panel3 text-ink' : 'text-sub hover:bg-panel2 hover:text-ink'}`}
          >
            <HeroAvatar hero={h} size={18} />
            {h.name}
          </button>
        </span>
      ))}
      {heroes.length > 1 && (
        <button type="button" className="btn btn-ghost btn-sm ml-1" onClick={onClear}>
          清除路径
        </button>
      )}
      <span className="ml-auto text-[11.5px] text-dim">最多保留最近{PATH_MAX}个</span>
    </nav>
  );
}

function SelectedPanel({ relation, centerId, onClose, onCenter }: { relation: Relation; centerId: number; onClose: () => void; onCenter: (id: number) => void }) {
  const engine = useEngine();
  const otherId = relation.a === centerId ? relation.b : relation.a;
  const other = engine.byId.get(otherId);
  return (
    <RelationDetail
      relation={relation}
      perspective={centerId}
      onClose={onClose}
      actions={
        other && (
          <>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onCenter(other.id)}>
              以{other.name}为中心
            </button>
            <Link to={`/heroes/${other.id}`} className="btn btn-sm">
              {other.name}的英雄详情
            </Link>
          </>
        )
      }
    />
  );
}

function CenterPanel({ heroId, kinds, scene, n, onSelect }: { heroId: number; kinds: Evidence['kind'][] | null; scene: ReturnType<typeof parseScene>; n: number; onSelect: (r: Relation) => void }) {
  const engine = useEngine();
  const hero = engine.byId.get(heroId)!;
  const sectors = useMemo(() => egoSectors(engine, heroId, kinds, scene), [engine, heroId, kinds, scene]);
  const doubtful = useMemo(() => doubtfulOnlyCount(engine, heroId), [engine, heroId]);
  const p = hero.profile;
  const profileNote =
    p == null
      ? '这个英雄还没有机制档案，暂时没有机制推导的关系。'
      : p.status === 'needs_review'
        ? '官方技能原文在机制档案撰写后发生过变化，档案待复核，期间不参与机制推导和计分。'
        : p.status === 'unverified'
          ? '机制档案尚未完成盲审，暂不参与机制推导和计分。'
          : null;

  return (
    <section className="panel p-4">
      <div className="flex items-center gap-3">
        <HeroAvatar hero={hero} size={44} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold">{hero.name}</span>
            {hero.isLimited && <span className="chip !text-warn">限时</span>}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-mute">
            {hero.title}
            <TypeBadge type={hero.heroType} />
            {hero.heroType2 != null && <TypeBadge type={hero.heroType2} />}
          </div>
        </div>
        <Link to={`/heroes/${hero.id}`} className="btn btn-sm ml-auto">
          英雄详情
        </Link>
      </div>
      {profileNote && <p className="mt-3 rounded-md bg-warn/10 px-2.5 py-1.5 text-[12px] text-warn">{profileNote}</p>}
      <p className="mt-3 text-[12px] text-mute">单击图中头像或下方列表查看这条关系的依据；双击头像以它为中心继续探索。列表按计分权重降序。</p>

      <div className="mt-3 space-y-4">
        {SECTOR_IDS.map((s) => {
          const sec = sectors[s];
          const color = SECTOR_COLOR[s];
          return (
            <div key={s}>
              <div className="mb-1 flex items-baseline gap-2">
                <h3 className={`text-[13px] font-semibold ${TEXT_COLOR[color]}`}>{SECTOR_LABEL[s]}</h3>
                <span className="text-[12px] text-mute">{SECTOR_HINT[s].replace('{name}', hero.name)}</span>
                <span className="ml-auto text-[11.5px] text-dim">
                  {sec.items.length === sec.total ? `共${sec.total}条` : `筛选后${sec.items.length}条 / 共${sec.total}条`}
                </span>
              </div>
              <ShowMore
                items={sec.items}
                initial={n}
                render={(it) => <RelationRow key={it.other.id} relation={it.relation} heroes={[it.other]} onClick={() => onSelect(it.relation)} />}
                empty={<Empty className="!py-3">{sec.total ? '当前筛选下没有关系' : '暂无结论'}</Empty>}
              />
            </div>
          );
        })}
      </div>
      {doubtful > 0 && <p className="mt-3 text-[11.5px] text-dim">另有{doubtful}条关系只有存疑证据，不计分，图中不画出。</p>}
    </section>
  );
}

function EgoGuide({ onPick }: { onPick: (id: number) => void }) {
  const engine = useEngine();
  // 随机取几个有官方关系的英雄作为示例入口（每次进入页面随机一次）
  const [examples] = useState(() => {
    const has = engine.bundle.heroes.filter((h) =>
      [...engine.rel.counters(h.id), ...engine.rel.counteredBy(h.id), ...engine.rel.synergies(h.id)].some((r) => r.evidence.some((e) => e.kind === 'official')),
    );
    const pool = [...has];
    const out: typeof pool = [];
    while (pool.length && out.length < 8) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return out;
  });
  return (
    <section className="panel px-6 py-8">
      <h2 className="text-[15px] font-semibold">选择一个英雄开始探索</h2>
      <p className="prose-cn mt-2 max-w-[760px] text-[13px]">
        图谱以一个英雄为中心，分三个扇区展示：它克制的英雄、克制它的英雄、与它配合的英雄。关系来自官方英雄页面的说明、双方技能原文按规则推导的机制倾向，以及职业赛同队共现；每条关系都可以点开查看原文依据。在上方搜索框输入中文名、拼音或首字母即可选择。
      </p>
      {examples.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-[12px] text-mute">随便看看（随机选取的有官方关系说明的英雄）</div>
          <div className="flex flex-wrap gap-2">
            {examples.map((h) => (
              <button key={h.id} type="button" className="btn h-9 gap-2 pl-1.5" onClick={() => onPick(h.id)}>
                <HeroAvatar hero={h} size={26} />
                {h.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
