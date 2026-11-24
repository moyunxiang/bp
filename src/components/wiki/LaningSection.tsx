// 对线：教学视频里解说对这个英雄清线抢线、对线强弱、前期强弱的说法，每条都带视频出处。
import type { HeroData, LaneAspect } from '../../types.ts';
import { useEngine } from '../../lib/data.ts';
import { LEVEL_TEXT, earlyClearSkills, laneView, type Consensus, type LaneIndex } from '../../engine/laning.ts';
import { ClaimSource, LANING_NOTE } from '../play/LaneDuels.tsx';
import { Empty, HeroLink } from '../ui.tsx';
import { SubTitle, WikiSection } from './WikiSection.tsx';

const ASPECTS: [LaneAspect, string][] = [
  ['clear', '清线抢线'],
  ['lane', '对线强度'],
  ['duo', '发育路双人对线'],
  ['early', '前期强度'],
];
const LEVEL_CLASS: Record<Consensus, string> = { strong: 'bg-good/15 text-good', weak: 'bg-bad/15 text-bad', even: 'bg-panel3 text-sub', mixed: 'bg-warn/15 text-warn' };

/** 这个英雄有多少条对线说法（含点名对手、搭档的） */
export function laningCount(ix: LaneIndex, heroId: number): number {
  return (ix.data?.claims ?? []).filter((c) => c.hero === heroId || c.vs === heroId || c.with === heroId).length;
}

export function LaningSection({ hero }: { hero: HeroData }) {
  const { laning: ix, byId } = useEngine();
  if (!ix.data) return null;
  const views = ASPECTS.flatMap(([aspect, label]) => {
    const v = laneView(ix, hero.id, aspect);
    return v ? [{ label, v }] : [];
  });
  // 点名对手的说法：统一成“这个英雄对某某”的视角
  const versus = ix.data.claims
    .filter((c) => c.vs != null && (c.hero === hero.id || c.vs === hero.id))
    .map((c) => {
      const mine = c.hero === hero.id;
      const other = byId.get(mine ? c.vs! : c.hero);
      const level = mine ? c.level : c.level === 'strong' ? 'weak' : c.level === 'weak' ? 'strong' : 'even';
      return { c, other, level };
    })
    .filter((x) => x.other);
  const pairs = ix.data.claims.filter((c) => c.with != null && (c.hero === hero.id || c.with === hero.id)).map((c) => ({ c, other: byId.get(c.hero === hero.id ? c.with! : c.hero) }));
  const skills = earlyClearSkills(hero);
  const empty = !views.length && !versus.length && !pairs.length;
  return (
    <WikiSection id="laning" title="对线" note="来自教学视频里解说的说法">
      {empty ? (
        <Empty>已收录的教学视频里没有关于这个英雄对线强弱或清线快慢的明确说法。</Empty>
      ) : (
        <div className="space-y-4">
          {views.length > 0 && (
            <div className="space-y-3">
              {views.map(({ label, v }) => (
                <div key={v.aspect} data-laning-aspect={v.aspect}>
                  <div className="mb-1 flex items-center gap-2 text-[13px]">
                    <span className="font-semibold text-sub">{label}</span>
                    <span className={`rounded px-1.5 py-px text-[12px] ${LEVEL_CLASS[v.level]}`}>{LEVEL_TEXT[v.aspect][v.level]}</span>
                    <span className="text-[11.5px] text-dim">{v.level === 'mixed' ? '不同UP主说法相反，不下结论' : `${v.uploaders}位UP主的说法`}</span>
                  </div>
                  <ul className="space-y-1">
                    {v.claims.map((c, i) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px] leading-relaxed text-sub">
                        <span>
                          {c.lane && <span className="mr-1 text-mute">[{c.lane}]</span>}
                          {c.claim}
                        </span>
                        <ClaimSource ix={ix} claim={c} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {versus.length > 0 && (
            <div>
              <SubTitle count={versus.length}>对上具体英雄</SubTitle>
              <ul className="space-y-1.5">
                {versus.map(({ c, other, level }, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] leading-relaxed text-sub">
                    <span className={`rounded px-1.5 py-px text-[12px] ${LEVEL_CLASS[level]}`}>{level === 'strong' ? '占优' : level === 'weak' ? '吃亏' : '五五开'}</span>
                    <HeroLink hero={other!} />
                    <span>{c.claim}</span>
                    <ClaimSource ix={ix} claim={c} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {pairs.length > 0 && (
            <div>
              <SubTitle count={pairs.length}>搭档</SubTitle>
              <ul className="space-y-1.5">
                {pairs.map(({ c, other }, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] leading-relaxed text-sub">
                    <span className={`rounded px-1.5 py-px text-[12px] ${LEVEL_CLASS[c.level]}`}>{LEVEL_TEXT[c.aspect][c.level]}</span>
                    {other && <HeroLink hero={other} />}
                    <span>{c.claim}</span>
                    <ClaimSource ix={ix} claim={c} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {skills.length > 0 && <p className="mt-3 text-[12px] leading-relaxed text-dim">开局两级内能用的范围伤害技能（技能原文，已核实）：{skills.join('、')}。这只是事实，不代表清线快慢。</p>}
      <p className="mt-2 text-[11.5px] leading-relaxed text-dim">{LANING_NOTE}讲某个英雄的视频容易偏向这个英雄，对线强弱也会随版本变化，请留意视频日期。</p>
    </WikiSection>
  );
}
