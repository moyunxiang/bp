import { Link } from 'react-router-dom';
import { useEngine } from '../../lib/data.ts';
import { useUser } from '../../lib/userStore.ts';
import { HeroAvatar, Empty, Star } from '../ui.tsx';

export function Favorites() {
  const { byId } = useEngine();
  const fav = useUser((s) => s.favoriteHeroes);
  const toggle = useUser((s) => s.toggleFavoriteHero);
  if (!fav.length) return <Empty>还没有收藏英雄。在英雄详情页点击星标即可收藏。</Empty>;
  return (
    <div className="grid grid-cols-4 gap-2">
      {fav.map((id) => {
        const h = byId.get(id);
        return (
          <div key={id} className="flex items-center gap-2 rounded-md bg-panel2 p-2">
            {h ? (
              <Link to={`/heroes/${h.id}`} className="flex min-w-0 flex-1 items-center gap-2 hover:text-blue">
                <HeroAvatar hero={h} size={32} />
                <span className="truncate text-[13px]">{h.name}</span>
              </Link>
            ) : (
              <span className="flex-1 text-[13px] text-mute">未知英雄 #{id}</span>
            )}
            <Star on onClick={() => toggle(id)} title="取消收藏" />
          </div>
        );
      })}
    </div>
  );
}
