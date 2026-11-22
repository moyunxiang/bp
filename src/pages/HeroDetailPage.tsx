// 英雄百科：详情页。头部信息、技能、机制标签、机制解读、克制与配合、官方出装、版本改动。
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { HeroData } from '../types.ts';
import { useEngine } from '../lib/data.ts';
import { Empty, HeroAvatar } from '../components/ui.tsx';
import { HeroHeader } from '../components/wiki/HeroHeader.tsx';
import { SkillsSection } from '../components/wiki/SkillsSection.tsx';
import { TagOverview } from '../components/wiki/TagOverview.tsx';
import { ProfileSection } from '../components/wiki/ProfileSection.tsx';
import { RelationsSection } from '../components/wiki/RelationsSection.tsx';
import { BuildsSection } from '../components/wiki/BuildsSection.tsx';
import { heroPatches, PatchesSection } from '../components/wiki/PatchesSection.tsx';

const NAV = [
  { id: 'skills', label: '技能' },
  { id: 'tags', label: '机制标签' },
  { id: 'profile', label: '机制解读' },
  { id: 'relations', label: '克制与配合' },
  { id: 'builds', label: '出装与铭文' },
  { id: 'patches', label: '版本改动' },
];

/** 页内导航。hash 路由下不能用 #锚点 链接，改为 scrollIntoView；滚动时高亮当前所在的节 */
function SectionNav({ hero, counts }: { hero: HeroData; counts: Record<string, number | null> }) {
  const [active, setActive] = useState(NAV[0].id);
  useEffect(() => {
    const els = NAV.map((n) => document.getElementById(n.id)).filter((e): e is HTMLElement => !!e);
    const onScroll = () => {
      // 视口上方 120px 处所在的节
      let cur = NAV[0].id;
      for (const el of els) if (el.getBoundingClientRect().top <= 120) cur = el.id;
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4 && els.length) cur = els[els.length - 1].id;
      setActive(cur);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [hero.id]);

  return (
    <nav className="sticky top-16 space-y-3">
      <div className="panel flex items-center gap-2.5 p-2.5">
        <HeroAvatar hero={hero} size={32} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{hero.name}</div>
          <div className="truncate text-[11px] text-mute">{hero.title}</div>
        </div>
      </div>
      <ul className="panel p-1.5">
        {NAV.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => document.getElementById(n.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${active === n.id ? 'bg-panel3 text-ink' : 'text-mute hover:bg-panel2 hover:text-ink'}`}
            >
              {n.label}
              {counts[n.id] != null && <span className="text-[11px] text-dim">{counts[n.id]}</span>}
            </button>
          </li>
        ))}
      </ul>
      <Link to="/heroes" className="btn btn-ghost btn-sm w-full">
        ← 返回英雄列表
      </Link>
    </nav>
  );
}

function HeroDetail({ hero }: { hero: HeroData }) {
  const { rel, bundle } = useEngine();
  const p = hero.profile;
  const counts: Record<string, number | null> = {
    skills: hero.skills.length,
    tags: p ? new Set(p.tags.map((t) => t.tag)).size : null,
    profile: null,
    relations: [...rel.counters(hero.id), ...rel.counteredBy(hero.id), ...rel.synergies(hero.id)].filter((r) => r.weight > 0).length,
    builds: null,
    patches: heroPatches(bundle.patches, hero.id).length,
  };
  return (
    <div className="grid grid-cols-[168px_minmax(0,1fr)] gap-5">
      <aside>
        <SectionNav hero={hero} counts={counts} />
      </aside>
      <div className="min-w-0 space-y-4">
        <HeroHeader hero={hero} />
        <SkillsSection hero={hero} />
        <TagOverview hero={hero} />
        <ProfileSection hero={hero} />
        <RelationsSection hero={hero} />
        <BuildsSection hero={hero} />
        <PatchesSection hero={hero} />
      </div>
    </div>
  );
}

export function HeroDetailPage() {
  const { id } = useParams();
  const { byId } = useEngine();
  const hero = /^\d+$/.test(id ?? '') ? byId.get(Number(id)) : undefined;

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [id]);

  if (!hero) {
    return (
      <div className="mx-auto max-w-[560px] pt-16">
        <Empty className="py-10">
          <div className="text-[15px] text-sub">没有这个英雄</div>
          <div className="mt-1 text-[12px] text-dim">链接中的英雄ID“{id}”不在当前数据中，可能已改名或链接有误。</div>
          <Link to="/heroes" className="btn btn-sm mt-4">
            返回英雄列表
          </Link>
        </Empty>
      </div>
    );
  }

  // 以英雄ID为 key：切换英雄时重置展开、固定等局部状态
  return <HeroDetail key={hero.id} hero={hero} />;
}
