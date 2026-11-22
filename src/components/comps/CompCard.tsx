// 职业赛阵容卡片：头像（完整阵容带推断分路）、出现次数、日期范围、命中的体系、收藏。
import { useMemo } from 'react';
import { assignLanes } from '../../engine/lanes.ts';
import { useUser } from '../../lib/userStore.ts';
import { LaneBadge, Star } from '../ui.tsx';
import { AvatarRow, type ProComp } from './shared.tsx';

export function CompCard({ comp, selected, onSelect }: { comp: ProComp; selected: boolean; onSelect: () => void }) {
  const fav = useUser((s) => s.favoriteComps.includes(comp.key));
  const toggle = useUser((s) => s.toggleFavoriteComp);
  const lanes = useMemo(() => (comp.kind === 'lineup' ? assignLanes(comp.heroes.map((hero) => ({ hero }))).lanes : null), [comp]);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`cursor-pointer rounded-lg border p-3 transition-colors ${selected ? 'border-blue bg-blue/10' : 'border-line bg-panel2/50 hover:border-line2 hover:bg-panel2'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <AvatarRow
          heroes={comp.heroes}
          size={38}
          below={(h, i) => (
            <>
              <span className="w-full truncate text-center text-[11px] text-sub">{h.name}</span>
              {lanes && lanes[i] && <LaneBadge lane={lanes[i]} />}
            </>
          )}
        />
        <span
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Star on={fav} onClick={() => toggle(comp.key)} title={fav ? '取消收藏这套阵容' : '收藏这套阵容'} />
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
        <span className="text-sub">
          出现 <b className="text-ink">{comp.n}</b> 次
        </span>
        <span className="text-mute">
          {comp.first} ~ {comp.last}
        </span>
        {comp.missing.length > 0 && <span className="text-warn">{comp.missing.length}个英雄ID不在当前数据中</span>}
      </div>
      {comp.matches.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {comp.matches.map((m) => (
            <span key={m.archetype.id} className="chip !h-[18px] !text-[11px]">
              {m.archetype.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
