// 机制解读：概述、长处、短处、技能联动、机制细节。只展示已核实的条目。
import type { ReactNode } from 'react';
import type { HeroData, ProseItem } from '../../types.ts';
import { Empty } from '../ui.tsx';
import { ProfileNotice } from './TagOverview.tsx';
import { SubTitle, WikiSection } from './WikiSection.tsx';
import { skillName } from './util.ts';

function Refs({ hero, refs }: { hero: HeroData; refs: string[] }) {
  if (!refs.length) return <span className="text-[11px] text-dim">未指明技能</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {refs.map((r) => {
        const name = skillName(hero, r);
        return (
          <span key={r} className="inline-flex h-[18px] items-center rounded bg-panel3 px-1.5 text-[11px] text-mute" title={name ? `${r}：${name}` : r}>
            {r}
            {name && <span className="ml-1 text-sub">{name}</span>}
          </span>
        );
      })}
    </span>
  );
}

function ProseList({ hero, items, tone, empty }: { hero: HeroData; items: ProseItem[]; tone: 'good' | 'bad' | 'plain'; empty: string }) {
  if (!items.length) return <p className="text-[12.5px] text-dim">{empty}</p>;
  const bar = tone === 'good' ? 'bg-good/70' : tone === 'bad' ? 'bg-bad/70' : 'bg-line2';
  return (
    <ul className="space-y-2.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5">
          <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${bar}`} />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] leading-relaxed text-ink">{it.text}</p>
            {it.quote && <p className="quote mt-1 text-[12.5px]">“{it.quote}”</p>}
            <div className="mt-1">
              <Refs hero={hero} refs={it.refs} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Block({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-panel2/40 p-4">
      <SubTitle count={count}>{title}</SubTitle>
      {children}
    </div>
  );
}

export function ProfileSection({ hero }: { hero: HeroData }) {
  const p = hero.profile;
  const note = '根据官方技能原文整理，并经独立核对；不含强度评价';
  if (!p) {
    return (
      <WikiSection id="profile" title="机制解读" note={note}>
        <Empty>暂无机制档案</Empty>
      </WikiSection>
    );
  }
  const ok = <T extends { status: string }>(xs: T[]) => xs.filter((x) => x.status === 'verified');
  const strengths = ok(p.strengths);
  const weaknesses = ok(p.weaknesses);
  const combos = ok(p.combos);
  const interactions = ok(p.interactions);
  const summary = p.summary?.trim();

  return (
    <WikiSection id="profile" title="机制解读" note={note}>
      <ProfileNotice profile={p} />
      <div className="mb-4 rounded-lg bg-panel2/60 px-4 py-3">
        <span className="mr-2 text-[12px] text-mute">概述</span>
        {summary ? <span className="text-[14.5px] text-ink">{summary}</span> : <span className="text-[13px] text-dim">暂无概述</span>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Block title="长处" count={strengths.length}>
          <ProseList hero={hero} items={strengths} tone="good" empty="暂无已核实的条目" />
        </Block>
        <Block title="短处" count={weaknesses.length}>
          <ProseList hero={hero} items={weaknesses} tone="bad" empty="暂无已核实的条目" />
        </Block>

        <Block title="技能联动" count={combos.length}>
          {combos.length === 0 ? (
            <p className="text-[12.5px] text-dim">暂无已核实的条目</p>
          ) : (
            <ul className="space-y-3">
              {combos.map((c, i) => (
                <li key={i}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {c.order.map((slot, j) => {
                      const name = skillName(hero, slot);
                      return (
                        <span key={j} className="inline-flex items-center gap-1.5">
                          {j > 0 && <span className="text-dim">→</span>}
                          <span className="inline-flex h-6 items-center rounded-md border border-line2 bg-panel3 px-2 text-[12.5px] text-ink" title={name ?? undefined}>
                            {slot}
                            {name && <span className="ml-1 text-[11.5px] text-mute">{name}</span>}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink">{c.why}</p>
                  {c.quote && <p className="quote mt-1 text-[12.5px]">“{c.quote}”</p>}
                </li>
              ))}
            </ul>
          )}
        </Block>
        <Block title="机制细节" count={interactions.length}>
          <ProseList hero={hero} items={interactions} tone="plain" empty="暂无已核实的条目" />
        </Block>
      </div>
    </WikiSection>
  );
}
