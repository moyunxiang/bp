// 英雄搜索选择框：中文名、拼音、首字母、外号；上下键切换，回车选择。
import { useId, useMemo, useState } from 'react';
import { LANES, type HeroData } from '../../types.ts';
import { useEngine, sortByName } from '../../lib/data.ts';
import { searchHeroes } from '../../lib/search.ts';
import { HeroAvatar, LaneBadge } from '../ui.tsx';
import { LimitedChip } from './shared.tsx';

export function HeroPicker({
  onPick,
  disabledReason,
  placeholder = '搜索英雄：名字、拼音、首字母或外号',
  disabled = false,
  limit = 10,
}: {
  onPick: (h: HeroData) => void;
  /** 返回不可选的原因；返回 null 表示可选 */
  disabledReason?: (h: HeroData) => string | null;
  placeholder?: string;
  disabled?: boolean;
  limit?: number;
}) {
  const { bundle } = useEngine();
  const sorted = useMemo(() => [...bundle.heroes].sort(sortByName), [bundle]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  const results = useMemo(() => (q.trim() ? searchHeroes(sorted, q).slice(0, limit) : []), [sorted, q, limit]);
  const reasons = results.map((h) => disabledReason?.(h) ?? null);

  const pick = (i: number) => {
    const h = results[i];
    if (!h || reasons[i]) return;
    onPick(h);
    setQ('');
    setActive(0);
  };

  return (
    <div className="relative">
      <input
        className="input"
        value={q}
        disabled={disabled}
        placeholder={disabled ? '已选满' : placeholder}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(results.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            pick(active);
          } else if (e.key === 'Escape') {
            setQ('');
          }
        }}
      />
      {open && q.trim() && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-[38px] z-20 max-h-[360px] overflow-auto rounded-lg border border-line2 bg-panel shadow-xl shadow-black/40">
          {results.length === 0 && <li className="px-3 py-2 text-[12.5px] text-mute">没有匹配的英雄</li>}
          {results.map((h, i) => {
            const reason = reasons[i];
            return (
              <li
                key={h.id}
                role="option"
                aria-selected={i === active}
                aria-disabled={!!reason}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(i)}
                className={`flex items-center gap-2 px-2.5 py-1.5 text-[13px] ${reason ? 'cursor-not-allowed text-dim' : 'cursor-pointer'} ${i === active ? 'bg-panel3' : ''}`}
              >
                <HeroAvatar hero={h} size={24} dim={!!reason} />
                <span className={reason ? '' : 'text-ink'}>{h.name}</span>
                {h.isLimited && <LimitedChip />}
                <span className="flex gap-0.5">
                  {LANES.filter((l) => h.lanes[l - 1] >= 0.5).map((l) => (
                    <LaneBadge key={l} lane={l} muted={!!reason} />
                  ))}
                </span>
                {reason && <span className="ml-auto text-[11.5px]">{reason}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
