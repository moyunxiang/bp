// 对线判断：三路对线、中辅抢线、射辅对线。
// 结论只来自教学视频里解说的明确说法（每条可点开看出处）；没有说法的地方显示“暂无说法”。
import { useMemo, useState } from 'react';
import { LANE_NAME, type HeroData, type Lane, type LaneClaim } from '../../types.ts';
import { useEngine } from '../../lib/data.ts';
import { EDGE_TEXT, LEVEL_TEXT, laneDuels, type Consensus, type Edge, type LaneActor, type LaneDuel, type LaneIndex } from '../../engine/laning.ts';
import { HeroAvatar } from '../ui.tsx';

export const LANING_NOTE = '对线结论只来自教学视频里解说的明确说法，是解说个人的看法，不是统计数据，也不代表胜率；没有说法的地方不下结论。';

const EDGE_CLASS: Record<Edge, string> = { ally: 'text-good', enemy: 'text-bad', even: 'text-warn', unknown: 'text-mute' };
const LEVEL_CLASS: Record<Consensus, string> = { strong: 'text-good', weak: 'text-bad', even: 'text-sub', mixed: 'text-warn' };
const BASIS_TEXT: Record<LaneDuel['basis'], string> = { direct: '有点名双方的说法', both: '双方各有说法', one: '只有一方有说法', none: '双方都没有说法' };
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;

function useTeams(ally: HeroData[], enemy: HeroData[], allyLocks?: (Lane | null)[], enemyLocks?: (Lane | null)[]) {
  const { laning } = useEngine();
  return useMemo(
    () =>
      laneDuels(
        laning,
        ally.map((hero, i) => ({ hero, locked: allyLocks?.[i] ?? null })),
        enemy.map((hero, i) => ({ hero, locked: enemyLocks?.[i] ?? null })),
      ),
    [laning, ally, enemy, allyLocks, enemyLocks],
  );
}

/** 一条说法的出处：UP主 + 时间点，点击打开视频并跳到该时间 */
export function ClaimSource({ ix, claim }: { ix: LaneIndex; claim: LaneClaim }) {
  const v = ix.data?.videos[claim.bvid];
  return (
    <a href={`https://www.bilibili.com/video/${claim.bvid}?t=${claim.t}`} target="_blank" rel="noreferrer noopener" className="whitespace-nowrap text-[11.5px] text-dim hover:text-blue" title={v ? `${v.title}（${v.date}）` : claim.bvid}>
      {v?.uploader ?? claim.bvid} {mmss(claim.t)}
      {v ? `（${v.date.slice(0, 7)}）` : ''} ↗
    </a>
  );
}

function ClaimLine({ ix, claim, lead }: { ix: LaneIndex; claim: LaneClaim; lead: string }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px] leading-relaxed">
      <span className="text-sub">
        <span className="text-ink">{lead}</span>：{claim.claim}
      </span>
      <ClaimSource ix={ix} claim={claim} />
    </li>
  );
}

function Actor({ a, side }: { a: LaneActor; side: 'ally' | 'enemy' }) {
  return (
    <span className="inline-flex items-center gap-1 text-[12.5px]">
      <HeroAvatar hero={a.hero} size={20} ring={side === 'ally' ? 'ring-blue/60' : 'ring-red/60'} />
      <span className="text-sub">{a.hero.name}</span>
      {a.view ? (
        <span className={LEVEL_CLASS[a.view.level]} title={`${a.view.uploaders}位UP主的说法`}>
          {LEVEL_TEXT[a.view.aspect][a.view.level]}
        </span>
      ) : (
        <span className="text-dim">暂无说法</span>
      )}
    </span>
  );
}

function DuelRow({ d }: { d: LaneDuel }) {
  const { laning, byId } = useEngine();
  const [open, setOpen] = useState(false);
  const name = (id: number) => byId.get(id)?.name ?? `#${id}`;
  const claims = [...d.ally, ...d.enemy].flatMap((a) => (a.view ? a.view.claims.map((c) => ({ c, lead: `${a.hero.name}${LEVEL_TEXT[c.aspect][c.level]}` })) : []));
  const direct = d.direct.map(({ claim: c }) => ({ c, lead: `${name(c.hero)}对${name(c.vs!)}${c.level === 'strong' ? '占优' : c.level === 'weak' ? '吃亏' : '五五开'}` }));
  const pairs = d.pairs.map(({ claim: c }) => ({ c, lead: `${name(c.hero)}配${name(c.with!)}${LEVEL_TEXT[c.aspect][c.level]}` }));
  const all = [...direct, ...pairs, ...claims];
  const facts = [...d.ally, ...d.enemy].filter((a) => a.clearSkills.length);
  const expandable = all.length > 0 || facts.length > 0;
  const missing = d.ally.length === 0 ? '我方这一路还没选' : d.enemy.length === 0 ? '对面这一路还没选' : null;
  return (
    <div className="rounded-md border border-line bg-panel2/40" data-lane-duel={d.key} data-edge={d.edge}>
      <button type="button" className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 text-left ${expandable ? 'hover:bg-panel2' : 'cursor-default'}`} aria-expanded={expandable ? open : undefined} onClick={() => expandable && setOpen(!open)} title={d.about}>
        <span className="w-[76px] shrink-0 text-[12.5px] font-medium text-ink">{d.title}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {d.ally.map((a) => (
            <Actor key={a.hero.id} a={a} side="ally" />
          ))}
          {d.ally.length === 0 && <span className="text-[12px] text-dim">未选</span>}
          <span className="text-[11.5px] text-dim">对</span>
          {d.enemy.map((a) => (
            <Actor key={a.hero.id} a={a} side="enemy" />
          ))}
          {d.enemy.length === 0 && <span className="text-[12px] text-dim">未选</span>}
        </span>
        <span className="ml-auto flex items-baseline gap-1.5 text-[12px]">
          <span className={`font-medium ${EDGE_CLASS[d.edge]}`}>{d.edge === 'unknown' && missing ? missing : `${d.basis === 'one' && d.edge !== 'unknown' ? '可能' : ''}${EDGE_TEXT[d.edge]}`}</span>
          {d.basis !== 'none' && <span className="text-[11px] text-dim">{BASIS_TEXT[d.basis]}</span>}
          {expandable && <span className={`inline-block text-mute transition-transform ${open ? 'rotate-90' : ''}`}>›</span>}
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-line px-3 py-2">
          {all.length > 0 && (
            <ul className="space-y-1">
              {all.map(({ c, lead }, i) => (
                <ClaimLine key={i} ix={laning} claim={c} lead={lead} />
              ))}
            </ul>
          )}
          {facts.length > 0 && (
            <p className="text-[11.5px] leading-relaxed text-dim">
              开局两级内能用的范围伤害技能（技能原文，已核实；只是事实，不代表清线快慢）：
              {facts.map((a) => `${a.hero.name} ${a.clearSkills.join('、')}`).join('；')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export interface LaneDuelsProps {
  ally: HeroData[];
  enemy: HeroData[];
  allyLocks?: (Lane | null)[];
  enemyLocks?: (Lane | null)[];
}

/** 完整列表：每一项可以展开看说法和出处 */
export function LaneDuelList(props: LaneDuelsProps) {
  const duels = useTeams(props.ally, props.enemy, props.allyLocks, props.enemyLocks);
  if (!duels.length) return null;
  return (
    <div className="space-y-1.5" data-testid="lane-duels">
      {duels.map((d) => (
        <DuelRow key={d.key} d={d} />
      ))}
    </div>
  );
}

const SHORT: Record<LaneDuel['key'], string> = { top: LANE_NAME[1], mid: LANE_NAME[3], bot: LANE_NAME[4], midRoam: '中辅抢线', botRoam: '射辅对线' };

/** 选人面板里的一行摘要：只列出已经有结论的对线 */
export function LaneDuelBar({ who, ...props }: LaneDuelsProps & { who: string }) {
  const duels = useTeams(props.ally, props.enemy, props.allyLocks, props.enemyLocks);
  // 只列双方这一路都有人、并且有结论的对线
  const known = duels.filter((d) => d.edge !== 'unknown' && d.ally.length > 0 && d.enemy.length > 0);
  if (!props.ally.length || !props.enemy.length) return null;
  return (
    <div className="mb-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-md border border-line bg-panel2/40 px-2.5 py-1.5 text-[12px]" data-testid="lane-bar" title={LANING_NOTE}>
      <span className="text-mute">{who}对线</span>
      {known.map((d) => (
        <span key={d.key} data-lane-duel={d.key} data-edge={d.edge}>
          <span className="text-sub">{SHORT[d.key]}</span>{' '}
          <span className={EDGE_CLASS[d.edge]}>
            {d.basis === 'one' ? '可能' : ''}
            {d.edge === 'ally' ? '占优' : d.edge === 'enemy' ? '吃亏' : '相当'}
          </span>
        </span>
      ))}
      {known.length === 0 && <span className="text-dim">已选英雄之间还没有可比的说法</span>}
      <span className="ml-auto text-[11px] text-dim">解说的说法 · 详见“打法”</span>
    </div>
  );
}
