// 英雄选择区：常驻搜索框 + 英雄网格。
import { forwardRef, useMemo } from 'react';
import { HERO_TYPE_NAME, LANES, LANE_SHORT, type HeroData, type Lane } from '../../types.ts';
import { useEngine } from '../../lib/data.ts';
import { searchHeroes } from '../../lib/search.ts';
import { unavailableReason, type DraftState, type Slot, type Unavailable } from '../../engine/draft.ts';
import { HeroAvatar } from '../ui.tsx';

const REASON: Record<Exclude<Unavailable, null>, string> = { banned: '已禁', picked: '已选', group: '同英雄', limited: '限时' };

export interface PickerFilter {
  lane: Lane | 0;
  type: number;
}

/** 当前查询下的结果列表（已按可用性分组），供页面的键盘操作复用 */
export function usePickerResults(draft: DraftState, active: Slot | null, query: string, filter: PickerFilter) {
  const { bundle, byId } = useEngine();
  return useMemo(() => {
    let list = searchHeroes(bundle.heroes, query);
    if (!query.trim()) {
      // 没有输入时按分路/职业筛选，并按拼音排序；有输入时忽略筛选，避免“搜不到”
      if (filter.lane) list = list.filter((h) => h.lanes[filter.lane - 1] >= 0.3);
      if (filter.type) list = list.filter((h) => h.heroType === filter.type || h.heroType2 === filter.type);
      list = [...list].sort((a, b) => a.pinyin.localeCompare(b.pinyin));
    }
    const slot = active ?? ({ side: 'blue', kind: 'pick', index: 0 } as Slot);
    const items = list.map((hero) => ({ hero, reason: unavailableReason(draft, hero, slot, byId) }));
    const available = items.filter((x) => x.reason == null).map((x) => x.hero);
    return { items, available };
  }, [bundle.heroes, byId, draft, active, query, filter.lane, filter.type]);
}

interface PickerProps {
  query: string;
  onQuery: (q: string) => void;
  filter: PickerFilter;
  onFilter: (f: PickerFilter) => void;
  items: { hero: HeroData; reason: Unavailable }[];
  available: HeroData[];
  onPick: (hero: HeroData) => void;
  placeholder: string;
  disabled: boolean;
}

export const Picker = forwardRef<HTMLInputElement, PickerProps>(function Picker({ query, onQuery, filter, onFilter, items, available, onPick, placeholder, disabled }, ref) {
  const hasQuery = query.trim().length > 0;
  const numberOf = new Map(available.slice(0, 9).map((h, i) => [h.id, i + 1]));
  return (
    <div className="panel flex min-h-0 flex-col">
      <div className="space-y-2 border-b border-line p-3">
        <input
          ref={ref}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={placeholder}
          className="input !h-10 !text-[15px]"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="搜索英雄"
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="seg">
            <button type="button" aria-pressed={filter.lane === 0} onClick={() => onFilter({ ...filter, lane: 0 })}>
              全部
            </button>
            {LANES.map((l) => (
              <button key={l} type="button" aria-pressed={filter.lane === l} onClick={() => onFilter({ ...filter, lane: filter.lane === l ? 0 : l })}>
                {LANE_SHORT[l]}
              </button>
            ))}
          </div>
          <div className="seg">
            {[1, 2, 3, 4, 5, 6].map((t) => (
              <button key={t} type="button" aria-pressed={filter.type === t} onClick={() => onFilter({ ...filter, type: filter.type === t ? 0 : t })}>
                {HERO_TYPE_NAME[t]}
              </button>
            ))}
          </div>
          <span className="ml-auto text-[11.5px] text-dim">{hasQuery ? `匹配 ${items.length} 个 · Enter 选第一个 · 数字键选对应序号` : `${items.length} 个英雄`}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {items.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-mute">没有匹配“{query}”的英雄。可以输入中文名、拼音、首字母或外号。</div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(62px,1fr))] gap-x-1 gap-y-2">
            {items.map(({ hero, reason }) => {
              const n = hasQuery ? numberOf.get(hero.id) : undefined;
              return (
                <button
                  key={hero.id}
                  type="button"
                  disabled={disabled || reason != null}
                  onClick={() => onPick(hero)}
                  title={reason ? `${hero.name}（${REASON[reason]}）` : hero.name}
                  className="group relative flex flex-col items-center gap-1 rounded-lg px-0.5 py-1 transition-colors enabled:hover:bg-panel2"
                >
                  <span className="relative">
                    <HeroAvatar hero={hero} size={46} dim={reason != null} className="transition-transform group-enabled:group-hover:scale-105" />
                    {n && <span className="absolute -left-1 -top-1 flex h-4 w-4 items-center justify-center rounded bg-gold text-[10.5px] font-semibold text-bg">{n}</span>}
                    {reason && <span className="absolute inset-x-0 bottom-0 rounded-b bg-bg/85 text-center text-[10px] leading-4 text-mute">{REASON[reason]}</span>}
                  </span>
                  <span className={`w-full truncate text-center text-[11.5px] ${reason ? 'text-dim' : 'text-sub'}`}>{hero.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
