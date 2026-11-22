// 英雄搜索选择：输入框 + 下拉结果。支持中文名、拼音、首字母、外号；方向键选择，回车确认，Esc关闭。
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { searchHeroes } from '../../lib/search.ts';
import { sortByName, useEngine } from '../../lib/data.ts';
import type { HeroData } from '../../types.ts';
import { HeroAvatar } from '../ui.tsx';

export interface HeroPickerProps {
  onPick: (hero: HeroData) => void;
  /** 返回不可选的原因；返回 null 表示可选 */
  disabledReason?: (hero: HeroData) => string | null;
  placeholder?: string;
  autoFocus?: boolean;
  /** 按 Esc 或失去焦点时调用 */
  onClose?: () => void;
  /** 输入为空时也显示列表（用于弹出式选择） */
  showAllWhenEmpty?: boolean;
  className?: string;
  limit?: number;
}

export function HeroPicker({ onPick, disabledReason, placeholder = '搜索英雄：中文名、拼音、首字母或外号', autoFocus, onClose, showAllWhenEmpty, className = '', limit = 12 }: HeroPickerProps) {
  const engine = useEngine();
  const listId = useId();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(!!autoFocus);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // 键盘移动时让当前项保持可见
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const sorted = useMemo(() => [...engine.bundle.heroes].sort(sortByName), [engine]);
  const results = useMemo(() => {
    if (!q.trim() && !showAllWhenEmpty) return [];
    return searchHeroes(sorted, q).slice(0, q.trim() ? limit : 200);
  }, [sorted, q, limit, showAllWhenEmpty]);

  const pick = (h: HeroData) => {
    if (disabledReason?.(h)) return;
    onPick(h);
    setQ('');
    setActive(0);
  };

  const firstEnabled = (from: number, step: 1 | -1) => {
    for (let k = 0, i = from; k < results.length; k++, i = (i + step + results.length) % results.length) if (!disabledReason?.(results[i])) return i;
    return from;
  };

  const showList = open && (results.length > 0 || q.trim() !== '');

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        className="input"
        value={q}
        placeholder={placeholder}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          onClose?.();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => firstEnabled((a + 1) % Math.max(1, results.length), 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => firstEnabled((a - 1 + results.length) % Math.max(1, results.length), -1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const i = firstEnabled(Math.min(active, results.length - 1), 1);
            const h = results[i];
            if (h) pick(h);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setQ('');
            setOpen(false);
            onClose?.();
            inputRef.current?.blur();
          }
        }}
      />
      {showList && (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-[360px] overflow-y-auto rounded-lg border border-line2 bg-panel2 p-1 shadow-xl shadow-black/40"
        >
          {results.length === 0 && <li className="px-3 py-2 text-[12.5px] text-mute">没有匹配的英雄</li>}
          {results.map((h, i) => {
            const reason = disabledReason?.(h) ?? null;
            return (
              <li
                key={h.id}
                role="option"
                aria-selected={i === active}
                aria-disabled={!!reason}
                // 用 mousedown 避免输入框先失焦导致列表关闭
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(h);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${reason ? 'cursor-not-allowed opacity-45' : ''} ${i === active && !reason ? 'bg-panel3 text-ink' : 'text-sub hover:bg-panel3'}`}
              >
                <HeroAvatar hero={h} size={24} dim={!!reason} />
                <span className="text-ink">{h.name}</span>
                <span className="truncate text-[12px] text-mute">{h.title}</span>
                {h.isLimited && <span className="chip !h-[18px] !text-[11px] !text-warn">限时</span>}
                {reason && <span className="ml-auto shrink-0 text-[11.5px] text-mute">{reason}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
