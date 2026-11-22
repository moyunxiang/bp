// 机制标签总览：按标签分组展示，悬停或点击查看依据的技能、原文片段与标签定义。
import { useMemo, useState } from 'react';
import type { HeroData, HeroProfile, ProfileTag, TagDef } from '../../types.ts';
import { useEngine, useTagMap } from '../../lib/data.ts';
import { Empty, StatusBadge } from '../ui.tsx';
import { SkillIcon } from './SkillsSection.tsx';
import { WikiSection } from './WikiSection.tsx';

/** 档案状态提示：needs_review / unverified 时显示 */
export function ProfileNotice({ profile }: { profile: HeroProfile }) {
  if (profile.status === 'verified') return null;
  if (profile.status === 'needs_review') {
    return (
      <div className="mb-4 rounded-lg border border-warn/40 bg-warn/10 px-4 py-2.5 text-[13px] text-warn">
        <b className="font-semibold">档案待复核：</b>官方技能原文在档案撰写后发生了变化，以下标签与解读可能已与当前技能不符，暂不参与推荐计分。
      </div>
    );
  }
  return (
    <div className="mb-4 rounded-lg border border-line2 bg-panel3/60 px-4 py-2.5 text-[13px] text-sub">
      <b className="font-semibold">档案未核实：</b>这份档案尚未经过独立核对，暂不参与推荐计分。
    </div>
  );
}

interface TagEntry {
  id: string;
  def: TagDef | undefined;
  items: ProfileTag[];
  verified: number;
}

export function TagOverview({ hero }: { hero: HeroData }) {
  const { bundle } = useEngine();
  const tagMap = useTagMap();
  const profile = hero.profile;
  const [pinned, setPinned] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const groups = useMemo(() => {
    if (!profile) return [];
    const byId = new Map<string, TagEntry>();
    for (const t of profile.tags) {
      let e = byId.get(t.tag);
      if (!e) {
        e = { id: t.tag, def: tagMap.get(t.tag), items: [], verified: 0 };
        byId.set(t.tag, e);
      }
      e.items.push(t);
      if (t.status === 'verified') e.verified++;
    }
    // 分组顺序与组内顺序沿用标签表；表里没有的标签归入“其他”
    const order = bundle.tags.map((t) => t.id);
    const groupOrder = [...new Set(bundle.tags.map((t) => t.group))];
    const out = new Map<string, TagEntry[]>();
    for (const e of [...byId.values()].sort((a, b) => (order.indexOf(a.id) + 1 || 999) - (order.indexOf(b.id) + 1 || 999))) {
      const g = e.def?.group ?? '其他';
      out.set(g, [...(out.get(g) ?? []), e]);
    }
    return [...out.entries()].sort((a, b) => (groupOrder.indexOf(a[0]) + 1 || 999) - (groupOrder.indexOf(b[0]) + 1 || 999));
  }, [profile, bundle.tags, tagMap]);

  const all = groups.flatMap(([, es]) => es);
  const shownId = hovered ?? pinned;
  const shown = all.find((e) => e.id === shownId) ?? null;
  const disputedCount = profile?.tags.filter((t) => t.status !== 'verified').length ?? 0;

  return (
    <WikiSection
      id="tags"
      title="机制标签"
      note="从官方技能原文中标注，每个标签都附原文片段"
      extra={
        profile && (
          <span className="text-[12px] text-mute">
            {all.length}种标签 · {profile.tags.length}处标注{disputedCount > 0 && <>，其中<span className="text-warn">{disputedCount}处存疑</span>（不计分）</>}
          </span>
        )
      }
    >
      {!profile ? (
        <Empty>暂无机制档案</Empty>
      ) : (
        <>
          <ProfileNotice profile={profile} />
          {all.length === 0 ? (
            <Empty>档案中没有标注任何机制标签</Empty>
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)_400px] gap-5">
              <div className="space-y-3">
                {groups.map(([g, es]) => (
                  <div key={g} className="flex gap-3">
                    <div className="w-12 shrink-0 pt-1 text-[12px] font-medium text-mute">{g}</div>
                    <div className="flex flex-1 flex-wrap gap-1.5">
                      {es.map((e) => {
                        const allDisputed = e.verified === 0;
                        const active = shownId === e.id;
                        const isPinned = pinned === e.id;
                        const slots = [...new Set(e.items.map((t) => t.slot))];
                        return (
                          <button
                            key={e.id}
                            type="button"
                            onMouseEnter={() => setHovered(e.id)}
                            onMouseLeave={() => setHovered(null)}
                            onFocus={() => setHovered(e.id)}
                            onBlur={() => setHovered(null)}
                            onClick={() => setPinned(isPinned ? null : e.id)}
                            aria-pressed={isPinned}
                            className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] transition-colors ${
                              allDisputed
                                ? `border-dashed ${active ? 'border-warn bg-warn/15' : 'border-warn/50 bg-warn/5'} text-warn`
                                : active
                                  ? 'border-blue/70 bg-blue/15 text-ink'
                                  : 'border-line2 bg-panel2 text-sub hover:border-dim hover:text-ink'
                            }`}
                          >
                            {e.def?.name ?? e.id}
                            <span className="text-[11px] text-dim">{slots.map((s) => (s === '被动' ? '被' : s.replace('技能', ''))).join('·')}</span>
                            {allDisputed && <span className="text-[10.5px]">存疑</span>}
                            {!allDisputed && e.verified < e.items.length && <span className="text-[10.5px] text-warn" title="部分技能上的这个标签存疑，不参与计分">部分存疑</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <p className="pt-1 text-[11.5px] text-dim">
                  标签后的数字表示出现在哪些技能（被＝被动）。虚线框为存疑标签：两位标注者意见不一致，不参与推荐计分。点击可固定显示依据。
                </p>
              </div>

              <aside className="min-h-[180px] rounded-lg border border-line bg-panel2/50 p-3.5">
                {shown ? (
                  <TagDetail hero={hero} entry={shown} pinned={pinned === shown.id} onUnpin={() => setPinned(null)} />
                ) : (
                  <div className="flex h-full items-center justify-center text-center text-[12.5px] text-dim">悬停或点击左侧标签，查看标签定义以及依据的技能和原文片段</div>
                )}
              </aside>
            </div>
          )}
        </>
      )}
    </WikiSection>
  );
}

function TagDetail({ hero, entry, pinned, onUnpin }: { hero: HeroData; entry: TagEntry; pinned: boolean; onUnpin: () => void }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-[14px] font-semibold text-ink">{entry.def?.name ?? entry.id}</span>
        {entry.def && <span className="chip">{entry.def.group}</span>}
        {pinned && (
          <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={onUnpin}>
            取消固定
          </button>
        )}
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-mute">
        <span className="text-sub">标签定义：</span>
        {entry.def?.def ?? '标签表中没有这个标签的定义'}
      </p>
      <ul className="mt-3 space-y-2.5">
        {entry.items.map((t, i) => {
          const skill = hero.skills.find((s) => s.slot === t.slot);
          return (
            <li key={i} className="flex gap-2.5">
              {skill ? <SkillIcon skill={skill} size={28} /> : <span className="h-7 w-7 shrink-0 rounded bg-panel3" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[12px]">
                  <span className="text-sub">{t.slot}</span>
                  {skill && <span className="text-ink">{skill.name}</span>}
                  {t.status !== 'verified' && <StatusBadge status={t.status} />}
                </div>
                <p className="quote mt-1 text-[12.5px]">“{t.quote}”</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
