// 职业赛阵容标签页：完整阵容与三人组合，按英雄/体系筛选，点击查看阵容分析。
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useEngine } from '../../lib/data.ts';
import { useUser } from '../../lib/userStore.ts';
import { Empty, HeroAvatar, Segmented, Star } from '../ui.tsx';
import { CompAnalysis } from './CompAnalysis.tsx';
import { CompCard } from './CompCard.tsx';
import { HeroPicker } from './HeroPicker.tsx';
import { Note, graphLink, newCompId, parseIds, resolveHeroes, useProComps, type ParamPatch, type ProComp } from './shared.tsx';

export function ProTab({ params, update }: { params: URLSearchParams; update: (p: ParamPatch, replace?: boolean) => void }) {
  const { bundle, byId } = useEngine();
  const pro = useProComps();
  const comps = bundle.comps;

  const hParam = params.get('h');
  const filterIds = useMemo(() => parseIds(hParam), [hParam]);
  const { heroes: filterHeroes, missing: filterMissing } = useMemo(() => resolveHeroes(byId, filterIds), [byId, filterIds]);
  const archParam = params.get('fa');
  const arch = bundle.archetypes.some((a) => a.id === archParam) ? archParam! : 'all';
  const selKey = params.get('comp');
  const selIds = useMemo(() => parseIds(selKey), [selKey]);

  const filtered = useMemo(() => {
    if (!pro) return [];
    return pro.filter((c) => filterHeroes.every((h) => c.ids.includes(h.id)) && (arch === 'all' || c.matches.some((m) => m.archetype.id === arch)));
  }, [pro, filterHeroes, arch]);

  if (!comps || !pro) return <Empty>当前数据包没有职业赛阵容数据（可能尚未抓取或聚合失败）。</Empty>;

  const lineups = filtered.filter((c) => c.kind === 'lineup');
  const trios = filtered.filter((c) => c.kind === 'trio');
  const selected = selKey ? pro.find((c) => c.key === selKey) ?? null : null;
  const setFilterIds = (ids: number[]) => update({ h: ids.length ? ids.join(',') : null }, true);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_600px] items-start gap-4">
      <div className="space-y-4">
        <section className="panel p-4">
          <p className="text-[13px] text-sub">
            职业赛数据范围 <b className="text-ink">{comps.from} ~ {comps.to}</b>（近{comps.windowDays}天），共 <b className="text-ink">{comps.teamGames}</b> 个队伍场次。
            完整阵容为同一队伍在一局中的5名英雄，三人组合为反复同队出现的3名英雄。
          </p>
          <p className="mt-1 text-[12px] text-warn">下面的数字是职业赛中的出现次数，不是胜率，也不代表路人局；列表按出现次数降序，不做排名。</p>
          <div className="mt-3 grid grid-cols-[320px_minmax(0,1fr)] gap-4">
            <div>
              <div className="mb-1 text-[12px] text-mute">按英雄筛选（同时包含所选英雄）</div>
              <HeroPicker
                onPick={(h) => setFilterIds([...filterIds, h.id])}
                disabledReason={(h) => (filterIds.includes(h.id) ? '已选' : null)}
                placeholder="搜索英雄加入筛选"
              />
              {(filterHeroes.length > 0 || filterMissing.length > 0) && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {filterHeroes.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md bg-panel3 py-0.5 pl-0.5 pr-1.5 text-[12px] text-sub hover:bg-bad/15 hover:text-bad"
                      title="移出筛选"
                      onClick={() => setFilterIds(filterIds.filter((x) => x !== h.id))}
                    >
                      <HeroAvatar hero={h} size={18} />
                      {h.name} ×
                    </button>
                  ))}
                  {filterMissing.length > 0 && <span className="text-[12px] text-warn">已忽略不存在的英雄ID：{filterMissing.join('、')}</span>}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilterIds([])}>
                    清除
                  </button>
                </div>
              )}
            </div>
            <div>
              <div className="mb-1 text-[12px] text-mute">按战术体系筛选（判定条件见“战术体系”标签页）</div>
              <Segmented
                value={arch}
                onChange={(v) => update({ fa: v === 'all' ? null : v }, true)}
                options={[{ value: 'all', label: '全部' }, ...bundle.archetypes.map((a) => ({ value: a.id, label: a.name }))]}
                className="flex-wrap"
              />
            </div>
          </div>
        </section>

        <CompList title="完整阵容" total={pro.filter((c) => c.kind === 'lineup').length} list={lineups} selKey={selKey} onSelect={(k) => update({ comp: k })} limit={12} />
        <CompList title="三人组合" total={pro.filter((c) => c.kind === 'trio').length} list={trios} selKey={selKey} onSelect={(k) => update({ comp: k })} limit={12} />
      </div>

      <aside className="sticky top-16 max-h-[calc(100vh-80px)] overflow-auto">
        {selKey && !selected ? (
          <div className="panel p-4">
            <Note tone="warn">链接中的阵容（{selKey}）不在当前职业赛数据中，可能已超出统计时间窗口。</Note>
            {selIds.length > 0 && (
              <div className="mt-3">
                <CompAnalysis heroIds={selIds} />
              </div>
            )}
          </div>
        ) : selected ? (
          <SelectedPanel comp={selected} onClose={() => update({ comp: null })} />
        ) : (
          <Empty className="panel">点击左侧阵容卡片，在这里查看阵容分析。</Empty>
        )}
      </aside>
    </div>
  );
}

function CompList({ title, total, list, selKey, onSelect, limit }: { title: string; total: number; list: ProComp[]; selKey: string | null; onSelect: (key: string) => void; limit: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, limit);
  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="panel-title">
          {title}
          <span className="ml-2 font-normal text-mute">
            {list.length === total ? `${total}套` : `筛选后${list.length}套 / 共${total}套`}
          </span>
        </h2>
        <span className="text-[12px] text-dim">按出现次数降序</span>
      </div>
      {list.length === 0 ? (
        <Empty>{total === 0 ? `数据中没有${title}。` : '没有符合筛选条件的阵容。'}</Empty>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-2">
            {shown.map((c) => (
              <CompCard key={c.key} comp={c} selected={c.key === selKey} onSelect={() => onSelect(c.key)} />
            ))}
          </div>
          {list.length > limit && (
            <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => setAll(!all)}>
              {all ? '收起' : `显示全部${list.length}套`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function SelectedPanel({ comp, onClose }: { comp: ProComp; onClose: () => void }) {
  const navigate = useNavigate();
  const fav = useUser((s) => s.favoriteComps.includes(comp.key));
  const toggle = useUser((s) => s.toggleFavoriteComp);
  const saveComp = useUser((s) => s.saveComp);
  const ids = useMemo(() => comp.heroes.map((h) => h.id), [comp]);

  const saveAsMine = () => {
    const id = newCompId();
    saveComp({
      id,
      name: `职业赛${comp.kind === 'lineup' ? '阵容' : '组合'}：${comp.heroes.map((h) => h.name).join(' ')}`,
      heroes: ids,
      note: `复制自职业赛${comp.kind === 'lineup' ? '完整阵容' : '三人组合'}（${comp.first} ~ ${comp.last}出现${comp.n}次）`,
    });
    navigate(`/comps?tab=mine&edit=${id}`);
  };

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="panel-title">阵容分析</h2>
          <p className="mt-0.5 text-[12px] text-mute">
            职业赛{comp.kind === 'lineup' ? '完整阵容' : '三人组合'} · 出现{comp.n}次 · {comp.first} ~ {comp.last}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Star on={fav} onClick={() => toggle(comp.key)} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} title="关闭">
            关闭
          </button>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm" onClick={saveAsMine}>
          另存为我的阵容
        </button>
        <Link className="btn btn-sm" to={graphLink(ids)}>
          在图谱中对阵查看
        </Link>
        <Link className="btn btn-sm" to={`/comps?tab=compare&a=pro:${comp.key}`}>
          拿去对比
        </Link>
      </div>
      <CompAnalysis heroIds={ids} />
    </div>
  );
}
