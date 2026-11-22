// 连招与细节：从B站教学视频提炼，每条都带可点击的视频出处（跳到对应时间）。
import type { GuideRef, HeroData, HeroGuide } from '../../types.ts';
import { useEngine } from '../../lib/data.ts';
import { Empty, HeroLink } from '../ui.tsx';
import { SkillIcon } from './SkillsSection.tsx';
import { SubTitle, WikiSection } from './WikiSection.tsx';

const mmss = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;

/** 出处：UP主 + 时间点，点击打开视频并跳到该时间 */
function Sources({ guide, refs, sources }: { guide: HeroGuide; refs: GuideRef[]; sources: number }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-dim">
      {sources >= 2 && <span className="rounded bg-good/15 px-1.5 py-px text-good">{sources}个来源都讲到</span>}
      {refs.map((r) => {
        const v = guide.videos.find((x) => x.bvid === r.bvid);
        return (
          <a
            key={r.bvid}
            href={`https://www.bilibili.com/video/${r.bvid}?t=${r.t}`}
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-blue"
            title={v ? `${v.title}（${v.date}）` : r.bvid}
          >
            {v?.uploader ?? r.bvid} {mmss(r.t)} ↗
          </a>
        );
      })}
    </span>
  );
}

/** 一步连招：数字对应官方技能（显示图标和技能名），A为普攻，其余原样显示 */
function Step({ hero, step }: { hero: HeroData; step: string }) {
  const skill = /^\d$/.test(step) ? hero.skills.find((s) => s.slot === `${step}技能`) : undefined;
  if (skill) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-line2 bg-panel py-0.5 pl-0.5 pr-2" title={`${skill.slot}：${skill.name}`}>
        <SkillIcon skill={skill} size={26} />
        <span className="text-[13px] font-semibold text-ink">{step}</span>
        <span className="text-[11.5px] text-mute">{skill.name}</span>
      </span>
    );
  }
  const plain = step === 'A' ? '普攻' : step === '闪' ? '闪现' : step;
  return (
    <span className="inline-flex h-[32px] items-center rounded-md border border-line bg-panel3 px-2 text-[12.5px] text-sub" title={plain}>
      {step === 'A' ? <><span className="font-semibold text-ink">A</span><span className="ml-1 text-[11.5px] text-mute">普攻</span></> : plain}
    </span>
  );
}

export function guideCount(guide: HeroGuide | undefined) {
  return guide ? guide.combos.length + guide.tips.length : 0;
}

export function GuideSection({ hero }: { hero: HeroData }) {
  const { bundle, byId, rel } = useEngine();
  /** 这条说法与已有依据方向相反、且没有被采信（存疑，不参与计分） */
  const conflicted = (m: HeroGuide['matchups'][number]) => {
    if (m.type === 'synergy') return false;
    const [a, b] = m.type === 'counter' ? [hero.id, m.hero] : [m.hero, hero.id];
    return !(rel.getCounter(a, b)?.weight ?? 0) && !!rel.getCounter(b, a)?.evidence.some((e) => e.kind === 'official');
  };
  const guide = bundle.guides?.[hero.id];
  const legend = hero.skills.filter((s) => s.slot !== '被动').map((s) => `${s.slot.replace('技能', '')}=${s.name}`).join('　');
  const note = '提炼自B站教学视频，逐条核对过字幕出处；点击出处可跳到视频对应时间';
  if (!guide || (!guide.combos.length && !guide.tips.length && !guide.matchups.length)) {
    return (
      <WikiSection id="guide" title="连招与细节" note={note}>
        <Empty className="py-4">还没有收录这个英雄的教学内容</Empty>
      </WikiSection>
    );
  }
  const compact = (steps: string[]) => steps.map((s) => (/^[\dA]$/.test(s) ? s : `·${s}·`)).join('').replace(/··/g, '·').replace(/^·|·$/g, '');
  const groups: [string, HeroGuide['matchups']][] = [
    ['教学视频里说它克制', guide.matchups.filter((m) => m.type === 'counter')],
    ['教学视频里说它怕', guide.matchups.filter((m) => m.type === 'countered')],
    ['教学视频里说的搭档', guide.matchups.filter((m) => m.type === 'synergy')],
  ];
  return (
    <WikiSection id="guide" title="连招与细节" note={note}>
      <p className="mb-4 rounded-md bg-panel2 px-3 py-2 text-[12px] leading-relaxed text-mute">
        连招里的数字按<b className="text-sub">官方技能顺序</b>：{legend}；A=普攻。有的玩家会在设置里调换技能位置，口头叫法可能和这里的数字不同，以技能名为准。
      </p>

      {guide.combos.length > 0 && (
        <>
          <SubTitle count={guide.combos.length}>连招</SubTitle>
          <ul className="mb-5 space-y-2.5">
            {guide.combos.map((c, i) => (
              <li key={i} className="rounded-lg border border-line bg-panel2/40 p-3.5">
                <div className="mb-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <span className="text-[13.5px] font-semibold text-ink">{c.name || `连招${i + 1}`}</span>
                  <span className={`rounded px-1.5 py-px text-[11px] ${c.level === '进阶' ? 'bg-gold/15 text-gold' : 'bg-panel3 text-mute'}`}>{c.level}</span>
                  <code className="rounded bg-panel3 px-1.5 py-px font-mono text-[12.5px] tracking-wide text-sub">{compact(c.steps)}</code>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {c.steps.map((s, j) => (
                    <span key={j} className="inline-flex items-center gap-1.5">
                      {j > 0 && <span className="text-[11px] text-dim">›</span>}
                      <Step hero={hero} step={s} />
                    </span>
                  ))}
                </div>
                {c.note && <p className="mt-2 text-[13px] leading-relaxed text-sub">{c.note}</p>}
                <div className="mt-1.5">
                  <Sources guide={guide} refs={c.refs} sources={c.sources} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {guide.tips.length > 0 && (
        <>
          <SubTitle count={guide.tips.length}>操作细节</SubTitle>
          <ul className="mb-5 grid grid-cols-2 gap-2.5">
            {guide.tips.map((t, i) => (
              <li key={i} className="rounded-lg border border-line bg-panel2/40 p-3.5">
                <div className="text-[13.5px] font-semibold text-ink">{t.title}</div>
                <p className="mt-1 text-[13px] leading-relaxed text-sub">{t.text}</p>
                <div className="mt-1.5">
                  <Sources guide={guide} refs={t.refs} sources={t.sources} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {guide.matchups.length > 0 && (
        <div className="grid grid-cols-3 gap-2.5">
          {groups.map(([title, list]) => (
            <div key={title} className="rounded-lg border border-line bg-panel2/40 p-3.5">
              <SubTitle count={list.length}>{title}</SubTitle>
              {list.length === 0 ? (
                <p className="text-[12.5px] text-dim">视频里没有提到</p>
              ) : (
                <ul className="space-y-2.5">
                  {list.map((m, i) => {
                    const other = byId.get(m.hero);
                    return (
                      <li key={i}>
                        {other ? <HeroLink hero={other} size={22} className="text-[13px] font-medium text-ink" /> : null}
                        {conflicted(m) && <span className="ml-2 rounded bg-warn/15 px-1.5 py-px text-[11px] text-warn" title="这条说法只有一个来源，且与官方页面的说明方向相反，所以没有计入推荐">与官方说明相反，未计分</span>}
                        <p className="mt-0.5 text-[12.5px] leading-relaxed text-sub">{m.claim}</p>
                        <Sources guide={guide} refs={m.refs} sources={m.sources} />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </WikiSection>
  );
}
