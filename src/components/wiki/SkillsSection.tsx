// 技能：官方原文 + 该技能上的机制标签。
import { useState } from 'react';
import type { HeroData, OfficialSkill, ProfileTag } from '../../types.ts';
import { fmtDate, useEngine, useTagMap } from '../../lib/data.ts';
import { WikiSection } from './WikiSection.tsx';
import { officialValue } from './util.ts';

/** 技能图标：热链官方图片，加载失败时退回槽位文字 */
export function SkillIcon({ skill, size = 48 }: { skill: OfficialSkill; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (failed || !skill.icon) {
    const label = skill.slot === '被动' ? '被动' : skill.slot.replace('技能', '');
    return (
      <span className="inline-flex shrink-0 select-none items-center justify-center rounded-lg border border-line2 bg-panel3 text-[13px] font-semibold text-sub" style={style} title={skill.name}>
        {label}
      </span>
    );
  }
  return (
    <img
      src={skill.icon}
      alt={skill.name}
      title={skill.name}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(true)}
      className="shrink-0 select-none rounded-lg border border-line2 bg-panel3 object-cover"
      style={style}
    />
  );
}

/** 一个机制标签小块：已核实正常显示，存疑显示警示样式；悬停显示定义与原文 */
export function TagChip({ tag, onClick, active }: { tag: ProfileTag; onClick?: () => void; active?: boolean }) {
  const def = useTagMap().get(tag.tag);
  const disputed = tag.status !== 'verified';
  const flag = tag.status === 'disputed' ? '存疑' : '未核实';
  const name = def?.name ?? tag.tag;
  const why = tag.status === 'disputed' ? '两位标注者意见不一致' : '尚未经独立核对';
  const title = `${name}${def ? `：${def.def}` : ''}\n依据原文：“${tag.quote}”${disputed ? `\n${flag}：${why}，不参与计分` : ''}`;
  const cls = disputed
    ? 'border border-dashed border-warn/50 bg-warn/10 text-warn'
    : active
      ? 'border border-blue/60 bg-blue/15 text-ink'
      : 'border border-transparent bg-panel3 text-sub';
  const body = (
    <>
      {name}
      {disputed && <span className="ml-1 text-[10.5px] opacity-80">{flag}</span>}
    </>
  );
  if (!onClick) {
    return (
      <span className={`inline-flex h-[20px] items-center rounded px-1.5 text-[11.5px] ${cls}`} title={title}>
        {body}
      </span>
    );
  }
  return (
    <button type="button" onClick={onClick} className={`inline-flex h-[20px] items-center rounded px-1.5 text-[11.5px] transition-colors hover:border-line2 hover:text-ink ${cls}`} title={title}>
      {body}
    </button>
  );
}

export function SkillsSection({ hero }: { hero: HeroData }) {
  const { bundle } = useEngine();
  const profile = hero.profile;
  const tagsBySlot = new Map<string, ProfileTag[]>();
  for (const t of profile?.tags ?? []) {
    const arr = tagsBySlot.get(t.slot) ?? [];
    arr.push(t);
    tagsBySlot.set(t.slot, arr);
  }
  const usable = profile?.status === 'verified';

  return (
    <WikiSection id="skills" title="技能" note={<>技能描述为官方原文，抓取于{fmtDate(bundle.meta.officialFetchedAt)}</>}>
      <div className="grid grid-cols-2 gap-3">
        {hero.skills.map((s) => {
          const tags = (tagsBySlot.get(s.slot) ?? []).slice().sort((a, b) => (a.status === 'verified' ? 0 : 1) - (b.status === 'verified' ? 0 : 1));
          return (
            <article key={`${s.idx}-${s.slot}`} className="flex gap-3 rounded-lg border border-line bg-panel2/50 p-3.5">
              <SkillIcon skill={s} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="chip !h-[18px] !text-[11px]">{s.slot}</span>
                  <span className="text-[14px] font-semibold text-ink">{s.name}</span>
                  <span className="ml-auto flex gap-3 text-[12px] text-mute">
                    <span>
                      冷却 <span className="text-sub">{officialValue(s.cooldown)}</span>
                    </span>
                    <span>
                      消耗 <span className="text-sub">{officialValue(s.cost)}</span>
                    </span>
                  </span>
                </div>
                <p className="prose-cn mt-1.5 whitespace-pre-line text-[13px]">{s.desc || '官方未提供描述'}</p>
                {profile && (
                  <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-line/70 pt-2">
                    <span className="mr-1 text-[11px] text-dim">机制标签</span>
                    {tags.length ? tags.map((t, i) => <TagChip key={`${t.tag}-${i}`} tag={t} />) : <span className="text-[11.5px] text-dim">无</span>}
                    {!usable && tags.length > 0 && <span className="ml-1 text-[11px] text-warn">档案待复核，暂不参与计分</span>}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {!profile && <p className="mt-3 text-[12px] text-dim">这个英雄暂无机制档案，技能上不显示机制标签。</p>}
    </WikiSection>
  );
}
