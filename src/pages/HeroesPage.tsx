// 英雄百科：列表页。搜索、分路/职业筛选、只看收藏；筛选状态保存在 URL 参数里。
import { useMemo, useRef, type KeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { HERO_TYPE_NAME, LANES, LANE_NAME } from '../types.ts';
import { sortByName, useEngine } from '../lib/data.ts';
import { searchHeroes } from '../lib/search.ts';
import { useUser } from '../lib/userStore.ts';
import { Empty, Segmented } from '../components/ui.tsx';
import { HeroCard } from '../components/wiki/HeroCard.tsx';

const TYPE_IDS = [1, 2, 3, 4, 5, 6];

const parseInRange = (v: string | null, allowed: number[]) => {
  const n = Number(v);
  return allowed.includes(n) ? n : 0;
};

export function HeroesPage() {
  const { bundle } = useEngine();
  const favorites = useUser((s) => s.favoriteHeroes);
  const toggleFavorite = useUser((s) => s.toggleFavoriteHero);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const q = params.get('q') ?? '';
  const lane = parseInRange(params.get('lane'), LANES);
  const type = parseInRange(params.get('type'), TYPE_IDS);
  const favOnly = params.get('fav') === '1';

  const update = (patch: Record<string, string | null>, replace = false) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v == null || v === '' || v === '0') next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace },
    );
  };

  const sorted = useMemo(() => [...bundle.heroes].sort(sortByName), [bundle.heroes]);
  const favSet = useMemo(() => new Set(favorites), [favorites]);

  const list = useMemo(() => {
    let hs = searchHeroes(sorted, q);
    if (lane) hs = hs.filter((h) => h.lanes[lane - 1] >= 0.5);
    if (type) hs = hs.filter((h) => h.heroType === type || h.heroType2 === type);
    if (favOnly) hs = hs.filter((h) => favSet.has(h.id));
    return hs;
  }, [sorted, q, lane, type, favOnly, favSet]);

  const filtered = !!(q.trim() || lane || type || favOnly);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && list.length > 0) navigate(`/heroes/${list[0].id}`);
    if (e.key === 'Escape' && q) {
      e.preventDefault();
      update({ q: null }, true);
    }
  };

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[18px] font-semibold text-ink">英雄百科</h1>
            <p className="mt-0.5 text-[12px] text-mute">技能原文、机制标签、克制与配合关系的依据、官方推荐出装与版本改动。</p>
          </div>
          <div className="text-[13px] text-sub">
            {filtered ? (
              <>
                找到 <b className="text-ink">{list.length}</b> 位英雄 <span className="text-dim">/ 共{bundle.heroes.length}位</span>
              </>
            ) : (
              <>
                共 <b className="text-ink">{bundle.heroes.length}</b> 位英雄
              </>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2.5">
          <div className="relative w-[380px]">
            <input
              ref={inputRef}
              autoFocus
              className="input pr-[104px]"
              placeholder="名字、拼音、首字母或外号"
              value={q}
              onChange={(e) => update({ q: e.target.value }, true)}
              onKeyDown={onKeyDown}
              aria-label="搜索英雄"
            />
            {q ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm absolute right-1.5 top-1/2 -translate-y-1/2"
                onClick={() => {
                  update({ q: null }, true);
                  inputRef.current?.focus();
                }}
              >
                清除
              </button>
            ) : (
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-dim">
                <span className="kbd">Enter</span> 打开首个
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[12px] text-mute">分路</span>
            <Segmented
              value={lane}
              onChange={(v) => update({ lane: String(v) })}
              options={[{ value: 0, label: '全部' }, ...LANES.map((l) => ({ value: l as number, label: LANE_NAME[l], title: `常规分路包含${LANE_NAME[l]}的英雄` }))]}
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[12px] text-mute">职业</span>
            <Segmented
              value={type}
              onChange={(v) => update({ type: String(v) })}
              options={[{ value: 0, label: '全部' }, ...TYPE_IDS.map((t) => ({ value: t, label: HERO_TYPE_NAME[t], title: `官方主职业或副职业为${HERO_TYPE_NAME[t]}` }))]}
            />
          </div>

          <button
            type="button"
            className={`btn btn-sm ${favOnly ? '!border-gold/60 !text-gold' : ''}`}
            aria-pressed={favOnly}
            onClick={() => update({ fav: favOnly ? null : '1' })}
            title={`只显示已收藏的英雄（已收藏${favorites.length}位）`}
          >
            {favOnly ? '★' : '☆'} 只看收藏
            <span className="text-dim">{favorites.length}</span>
          </button>

          {filtered && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              重置筛选
            </button>
          )}
        </div>
      </div>

      {list.length === 0 ? (
        <Empty className="py-12">
          {favOnly && favorites.length === 0 ? (
            <>还没有收藏英雄。在英雄卡片或详情页点击 ☆ 即可收藏。</>
          ) : (
            <>没有符合条件的英雄{q.trim() && <>（搜索“{q.trim()}”）</>}。</>
          )}
          <div className="mt-3">
            <button type="button" className="btn btn-sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              清除全部筛选
            </button>
          </div>
        </Empty>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(272px,1fr))] gap-3">
          {list.map((h) => (
            <HeroCard key={h.id} hero={h} favorite={favSet.has(h.id)} onToggleFavorite={() => toggleFavorite(h.id)} />
          ))}
        </div>
      )}

      <p className="text-[12px] text-dim">
        常规分路指分路适配权重不低于0.5的分路，来源见各英雄详情页。机制概述根据官方技能原文整理，不含强度评价。
      </p>
    </div>
  );
}
