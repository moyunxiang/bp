import { useMemo, useState } from 'react';
import { useEngine, sortByName } from '../../lib/data.ts';
import { useUser } from '../../lib/userStore.ts';
import { searchHeroes } from '../../lib/search.ts';
import { HeroAvatar } from '../ui.tsx';
import { LANES, LANE_NAME, type HeroData } from '../../types.ts';

const STARS = ['', '★', '★★', '★★★'];

export function HeroPool() {
  const { bundle } = useEngine();
  const pool = useUser((s) => s.pool);
  const setPool = useUser((s) => s.setPool);
  const [q, setQ] = useState('');
  const [onlyIn, setOnlyIn] = useState(false);
  const level = useMemo(() => new Map(pool.map((p) => [p.id, p.level])), [pool]);

  const heroes = useMemo(() => bundle.heroes.filter((h) => !h.isLimited), [bundle]);
  const matched = useMemo(() => new Set((q.trim() ? searchHeroes(heroes, q) : heroes).map((h) => h.id)), [heroes, q]);
  const cols = useMemo(
    () =>
      LANES.map((l) => {
        const all = heroes.filter((h) => (h.lanes[l - 1] ?? 0) >= 0.5).sort(sortByName);
        const joined = all.filter((h) => level.has(h.id)).length;
        const shown = all.filter((h) => matched.has(h.id) && (!onlyIn || level.has(h.id)));
        return { l, all, joined, shown };
      }),
    [heroes, level, matched, onlyIn],
  );

  const cycle = (h: HeroData) => {
    const cur = level.get(h.id) ?? 0;
    setPool(h.id, cur >= 3 ? null : cur + 1);
  };

  return (
    <div>
      <p className="mb-3 text-[12.5px] text-sub">点击英雄循环切换：未加入 → ★ → ★★ → ★★★ → 未加入，星数表示熟练度。BP助手里切到“我的英雄池”后只在池内推荐，并按熟练度加分。一个英雄可出现在多条分路，状态是同一个。已加入共 {pool.length} 个。</p>
      <div className="mb-3 flex items-center gap-3">
        <input className="input w-64" placeholder="搜索英雄（中文名、拼音、首字母）" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-sub">
          <input type="checkbox" checked={onlyIn} onChange={(e) => setOnlyIn(e.target.checked)} />
          只看已加入
        </label>
      </div>
      <div className="grid grid-cols-5 gap-3">
        {cols.map((c) => (
          <div key={c.l} className="rounded-lg bg-panel2 p-2">
            <div className="mb-2 flex items-baseline justify-between px-1">
              <span className="text-[13px] font-medium text-ink">{LANE_NAME[c.l]}</span>
              <span className="text-[12px] text-mute">已加入 {c.joined}/{c.all.length}</span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(58px,1fr))] gap-x-1 gap-y-2">
              {c.shown.map((h) => {
                const lv = level.get(h.id) ?? 0;
                return (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => cycle(h)}
                    aria-pressed={lv > 0}
                    title={lv ? `${h.name}：熟练度 ${lv}，点击切换` : `${h.name}：点击加入英雄池`}
                    className="group flex flex-col items-center gap-1 rounded-lg px-0.5 py-1 transition-colors hover:bg-panel3"
                  >
                    <span className="relative">
                      <HeroAvatar hero={h} size={44} ring={lv ? 'rgb(236 185 92 / 0.9)' : undefined} className={lv ? '' : 'opacity-55 transition-opacity group-hover:opacity-100'} />
                      {lv > 0 && <span className="absolute inset-x-0 -bottom-1 text-center text-[10px] leading-none text-gold [text-shadow:0_0_3px_#000,0_0_3px_#000]">{STARS[lv]}</span>}
                    </span>
                    <span className={`w-full truncate text-center text-[11.5px] ${lv ? 'text-ink' : 'text-mute'}`}>{h.name}</span>
                  </button>
                );
              })}
              {c.shown.length === 0 && <div className="col-span-full px-1 py-3 text-center text-[12px] text-dim">没有符合条件的英雄</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
