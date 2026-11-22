// 详情页头部：基本信息、分路来源、官方四维评分、同组形态、职业赛第一局数据。
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LANE_NAME, type HeroData } from '../../types.ts';
import { fmtDate, useEngine } from '../../lib/data.ts';
import { useUser } from '../../lib/userStore.ts';
import { HeroAvatar, LaneBadge, Star, TypeBadge } from '../ui.tsx';
import { LimitedChip } from './HeroCard.tsx';
import { groupSiblings, kplHeat, minorLanes, RATING_LABEL, regularLanes } from './util.ts';

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 text-[13px]">
      <span className="w-[4.5em] shrink-0 text-[12px] text-mute">{label}</span>
      <div className="min-w-0 flex-1 text-sub">{children}</div>
    </div>
  );
}

export function HeroHeader({ hero }: { hero: HeroData }) {
  const { bundle } = useEngine();
  const favorite = useUser((s) => s.favoriteHeroes.includes(hero.id));
  const toggle = useUser((s) => s.toggleFavoriteHero);
  const lanes = regularLanes(hero);
  const minor = minorLanes(hero);
  const siblings = groupSiblings(bundle.heroes, hero);
  const heat = kplHeat(bundle, hero);
  const fetched = fmtDate(bundle.meta.officialFetchedAt);

  return (
    <header className="panel overflow-hidden">
      <div className="flex gap-6 bg-gradient-to-r from-panel2 to-panel p-5">
        <HeroAvatar hero={hero} size={112} className="ring-1 ring-line2" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="text-[26px] font-bold leading-tight text-ink">{hero.name}</h1>
            <span className="text-[15px] text-sub">{hero.title}</span>
            <span className="flex items-center gap-1">
              <TypeBadge type={hero.heroType} />
              {hero.heroType2 != null && hero.heroType2 !== hero.heroType && <TypeBadge type={hero.heroType2} />}
              {hero.isLimited && <LimitedChip />}
            </span>
            <span className="flex items-center">
              <Star on={favorite} onClick={() => toggle(hero.id)} />
              <span className="text-[12px] text-mute">{favorite ? '已收藏' : '收藏'}</span>
            </span>
          </div>

          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_300px] gap-x-8 gap-y-2">
            <div className="space-y-1.5">
              <Meta label="分路">
                <span className="inline-flex flex-wrap items-center gap-1 align-middle">
                  {lanes.length ? lanes.map((l) => <LaneBadge key={l} lane={l} />) : <span className="text-dim">无常规分路</span>}
                  {minor.length > 0 && (
                    <>
                      <span className="ml-1.5 text-[12px] text-dim">偶尔</span>
                      {minor.map((l) => (
                        <span key={l} title={`${LANE_NAME[l]}：适配权重${hero.lanes[l - 1]}（低于0.5，不算常规分路）`}>
                          <LaneBadge lane={l} muted />
                        </span>
                      ))}
                    </>
                  )}
                </span>
                <span className="ml-2 text-[12px] text-mute">来源：{hero.laneSource || '未注明'}</span>
              </Meta>
              <Meta label="上线日期">{hero.releaseDate ? hero.releaseDate : <span className="text-dim">官方未提供</span>}</Meta>
              {hero.isLimited && <Meta label="限时">限时英雄，排位赛、巅峰赛不可用</Meta>}
              {siblings.length > 0 && (
                <Meta label="其他形态">
                  <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 align-middle">
                    {siblings.map((s) => (
                      <Link key={s.id} to={`/heroes/${s.id}`} className="inline-flex items-center gap-1.5 rounded px-1 hover:bg-panel3 hover:text-blue">
                        <HeroAvatar hero={s} size={20} />
                        {s.name}
                      </Link>
                    ))}
                  </span>
                  <span className="ml-2 text-[12px] text-warn">同一英雄的不同形态，BP中互斥</span>
                </Meta>
              )}
              <Meta label="职业赛">
                {heat ? (
                  <span title="统计每个系列赛的第一局（不受全局BP影响）">
                    职业赛第一局：{heat.games}局中被选<b className="text-ink">{heat.pick}</b>次、被禁<b className="text-ink">{heat.ban}</b>次
                    <span className="ml-2 text-[12px] text-mute">
                      {heat.from} ~ {heat.to}
                      {heat.scope === 'year' && '（近期局数不足20，改用一年窗口）'} · 仅为职业赛数据，不代表路人局
                    </span>
                  </span>
                ) : (
                  <span className="text-dim">暂无职业赛数据</span>
                )}
              </Meta>
              <Meta label="官方页面">
                <a href={hero.sourceUrl} target="_blank" rel="noreferrer" className="underline decoration-line2 underline-offset-2 hover:text-blue">
                  {hero.name}的官方英雄页面
                </a>
                <span className="ml-2 text-[12px] text-mute">抓取于{fetched}</span>
              </Meta>
            </div>

            <div className="rounded-lg border border-line bg-bg/40 px-3.5 py-3">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[12px] font-semibold text-sub">四维评分</span>
                <span className="text-[11px] text-dim">来自官方英雄页面</span>
              </div>
              <div className="space-y-1.5">
                {RATING_LABEL.map(([k, label]) => {
                  const v = Math.max(0, Math.min(100, hero.ratings[k] ?? 0));
                  return (
                    <div key={k} className="flex items-center gap-2 text-[12px]" title={`官方${label}评分：${v}（满分100）`}>
                      <span className="w-[4.5em] shrink-0 text-mute">{label}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel3">
                        <span className="block h-full rounded-full bg-blue/80" style={{ width: `${v}%` }} />
                      </span>
                      <span className="w-7 text-right text-sub">{v}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
