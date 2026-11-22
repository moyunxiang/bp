// 英雄列表中的一张卡片。
import { Link } from 'react-router-dom';
import type { HeroData } from '../../types.ts';
import { HeroAvatar, LaneBadge, Star, TypeBadge } from '../ui.tsx';
import { regularLanes } from './util.ts';

export function LimitedChip() {
  return (
    <span className="inline-flex h-[18px] items-center rounded bg-warn/15 px-1.5 text-[11px] text-warn" title="限时英雄：排位赛、巅峰赛不可用">
      限时
    </span>
  );
}

export function HeroCard({ hero, favorite, onToggleFavorite }: { hero: HeroData; favorite: boolean; onToggleFavorite: () => void }) {
  const lanes = regularLanes(hero);
  const summary = hero.profile?.summary?.trim();
  return (
    <div className="panel group relative transition-colors hover:border-line2 hover:bg-panel2/60">
      <Link to={`/heroes/${hero.id}`} className="flex h-full gap-3 rounded-[10px] p-3 pr-9">
        <HeroAvatar hero={hero} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[15px] font-semibold text-ink group-hover:text-blue">{hero.name}</span>
            <span className="truncate text-[12px] text-mute">{hero.title}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <TypeBadge type={hero.heroType} />
            {hero.heroType2 != null && hero.heroType2 !== hero.heroType && <TypeBadge type={hero.heroType2} />}
            {lanes.length > 0 && <span className="mx-0.5 h-3 w-px bg-line2" />}
            {lanes.map((l) => (
              <LaneBadge key={l} lane={l} />
            ))}
            {hero.isLimited && <LimitedChip />}
          </div>
          <p className={`mt-1.5 line-clamp-2 text-[12px] leading-relaxed ${summary ? 'text-sub' : 'text-dim'}`} title={summary || undefined}>
            {summary || '暂无机制概述'}
          </p>
        </div>
      </Link>
      <div className="absolute right-1.5 top-1.5">
        <Star on={favorite} onClick={onToggleFavorite} />
      </div>
    </div>
  );
}
