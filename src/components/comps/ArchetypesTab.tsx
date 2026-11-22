// 战术体系标签页：体系定义、判定条件、怕什么（列出符合条件的英雄）、职业赛实例。
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Archetype } from '../../types.ts';
import { useEngine } from '../../lib/data.ts';
import { heroesMatching } from '../../engine/comp.ts';
import { assignLanes } from '../../engine/lanes.ts';
import { LaneBadge } from '../ui.tsx';
import { AvatarRow, HeroChips, Note, Toggle, useProComps, useTagName, type ProComp } from './shared.tsx';

export function ArchetypesTab({ archId, onSelect }: { archId: string | null; onSelect: (id: string) => void }) {
  const { bundle } = useEngine();
  const pro = useProComps();
  const archetypes = bundle.archetypes;
  const instances = useMemo(() => {
    const m = new Map<string, ProComp[]>();
    for (const a of archetypes) m.set(a.id, (pro ?? []).filter((c) => c.kind === 'lineup' && c.matches.some((x) => x.archetype.id === a.id)));
    return m;
  }, [archetypes, pro]);

  if (!archetypes.length) return <Note>当前数据包没有战术体系定义。</Note>;
  const current = archetypes.find((a) => a.id === archId) ?? archetypes[0];
  const invalid = archId != null && !archetypes.some((a) => a.id === archId);

  return (
    <div className="space-y-3">
      <Note tone="warn">
        体系说明是通用的战术描述，不是数据结论，也不代表强度。判定条件由官方职业和已核实的机制标签计算；“职业赛实例”只是满足判定条件的职业赛阵容及其出现次数，不是胜率。
      </Note>
      {invalid && <Note>链接里的体系“{archId}”不存在，已显示第一个体系。</Note>}
      <div className="grid grid-cols-[240px_minmax(0,1fr)] gap-4">
        <nav className="panel h-fit p-2" aria-label="战术体系列表">
          {archetypes.map((a) => {
            const n = instances.get(a.id)?.length ?? 0;
            const on = a.id === current.id;
            return (
              <button
                key={a.id}
                type="button"
                aria-pressed={on}
                onClick={() => onSelect(a.id)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-[13.5px] transition-colors ${on ? 'bg-panel3 text-ink' : 'text-sub hover:bg-panel2 hover:text-ink'}`}
              >
                <span>{a.name}</span>
                {pro && <span className="text-[11.5px] text-mute">{n}套实例</span>}
              </button>
            );
          })}
        </nav>
        <ArchetypeDetail key={current.id} a={current} instances={instances.get(current.id) ?? []} hasPro={!!pro} />
      </div>
    </div>
  );
}

function ArchetypeDetail({ a, instances, hasPro }: { a: Archetype; instances: ProComp[]; hasPro: boolean }) {
  const { bundle } = useEngine();
  const tagName = useTagName();
  const pool = useMemo(() => bundle.heroes.filter((h) => !h.isLimited), [bundle]);
  const comps = bundle.comps;
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? instances : instances.slice(0, 5);

  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <div className="flex items-center gap-2">
          <h2 className="text-[18px] font-semibold text-ink">{a.name}</h2>
          <span className="chip">通用战术描述</span>
        </div>
        <p className="prose-cn mt-2 text-[14px]">{a.description}</p>
        <div className="mt-3 rounded-md border border-line bg-panel2/60 px-3 py-2">
          <div className="text-[12px] font-medium text-mute">Win Condition</div>
          <p className="prose-cn text-[13.5px]">{a.winCondition}</p>
        </div>
      </section>

      {(a.play || a.against) && (
        <div className="grid grid-cols-2 gap-4" data-testid="arch-play">
          {a.play && (
            <section className="panel p-4">
              <h3 className="panel-title">局内怎么打</h3>
              <dl className="mt-3 grid grid-cols-[3.4em_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px] leading-relaxed">
                {(
                  [
                    ['early', '前期'],
                    ['mid', '中期'],
                    ['fight', '团战'],
                    ['avoid', '不要做'],
                  ] as const
                ).map(([k, label]) => (
                  <div key={k} className="contents">
                    <dt className={k === 'avoid' ? 'text-bad' : 'text-mute'}>{label}</dt>
                    <dd className="text-sub">{a.play![k]}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {a.against && (
            <section className="panel p-4">
              <h3 className="panel-title">对面是这个体系时怎么打</h3>
              <p className="prose-cn mt-3 text-[13px] leading-relaxed text-sub">{a.against}</p>
            </section>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <section className="panel p-4">
          <h3 className="panel-title">判定条件</h3>
          <p className="mt-0.5 text-[12px] text-mute">阵容中满足每一条的英雄数都达到所需人数，即判定为该体系。</p>
          <ul className="mt-3 space-y-3">
            {a.needs.map((n, i) => (
              <NeedRow key={i} label={n.label} count={n.count} heroes={heroesMatching(pool, n.cond, tagName)} />
            ))}
          </ul>
        </section>
        <section className="panel p-4">
          <h3 className="panel-title">怕什么</h3>
          <p className="mt-0.5 text-[12px] text-mute">条件来自体系定义；下面按已核实机制标签列出符合条件的英雄（不含限时英雄），不代表一定克制。</p>
          {a.weakTo.length === 0 ? (
            <p className="mt-3 text-[12.5px] text-mute">体系定义中没有列出。</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {a.weakTo.map((w, i) => {
                const heroes = heroesMatching(pool, w.cond, tagName);
                return (
                  <li key={i}>
                    <div className="mb-1 text-[13px] text-bad">
                      {w.label}
                      <span className="ml-1.5 text-[12px] text-mute">{heroes.length}个英雄</span>
                    </div>
                    <HeroChips heroes={heroes} limit={10} size={18} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="panel p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="panel-title">职业赛实例</h3>
          {comps && (
            <span className="text-[12px] text-mute">
              职业赛数据 {comps.from} ~ {comps.to} · 共{comps.teamGames}个队伍场次 · 出现次数不是胜率
            </span>
          )}
        </div>
        {!hasPro ? (
          <p className="mt-3 text-[12.5px] text-mute">当前数据包没有职业赛阵容数据。</p>
        ) : instances.length === 0 ? (
          <p className="mt-3 text-[12.5px] text-mute">自动发现的职业赛完整阵容中，没有符合该体系判定条件的。</p>
        ) : (
          <>
            <p className="mt-0.5 text-[12px] text-mute">自动发现的职业赛完整阵容中有{instances.length}套符合判定条件，按出现次数排列。点击查看阵容分析。</p>
            <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-2">
              {shown.map((c) => (
                <InstanceCard key={c.key} c={c} archId={a.id} />
              ))}
            </div>
            {instances.length > 5 && (
              <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => setShowAll(!showAll)}>
                {showAll ? '收起' : `显示全部${instances.length}套`}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function NeedRow({ label, count, heroes }: { label: string; count: number; heroes: ReturnType<typeof heroesMatching> }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-ink">{label}</span>
        <span className="chip">需要≥{count}人</span>
        <Toggle open={open} onClick={() => setOpen(!open)}>
          符合的英雄{heroes.length}个
        </Toggle>
      </div>
      {open && (
        <div className="mt-1.5">
          <HeroChips heroes={heroes} limit={20} size={18} />
        </div>
      )}
    </li>
  );
}

function InstanceCard({ c, archId }: { c: ProComp; archId: string }) {
  const lanes = useMemo(() => assignLanes(c.heroes.map((hero) => ({ hero }))).lanes, [c]);
  const cores = new Set(c.matches.find((m) => m.archetype.id === archId)?.cores.map((h) => h.id) ?? []);
  return (
    <Link to={`/comps?tab=pro&comp=${c.key}`} className="block rounded-lg border border-line bg-panel2/50 p-3 transition-colors hover:border-line2 hover:bg-panel2">
      <AvatarRow
        heroes={c.heroes}
        size={34}
        ring={(h) => (cores.has(h.id) ? 'var(--color-good)' : undefined)}
        below={(h, i) => (
          <>
            <span className="w-full truncate text-center text-[11px] text-sub">{h.name}</span>
            {lanes[i] && <LaneBadge lane={lanes[i]} />}
          </>
        )}
      />
      <div className="mt-2 flex items-center gap-3 text-[12px]">
        <span className="text-sub">
          出现 <b className="text-ink">{c.n}</b> 次
        </span>
        <span className="text-mute">
          {c.first} ~ {c.last}
        </span>
        <span className="ml-auto text-[11.5px] text-dim">绿框为满足条件的英雄</span>
      </div>
    </Link>
  );
}
