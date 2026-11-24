// 局内打法：我方怎么打、对面的突破口、要防的点、出装针对、分路对位。
// 文字来自打法表和体系定义（通用战术说明），由双方阵容的官方职业与已核实技能标签触发；每条都可以展开看依据。
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LANE_NAME, type HeroData, type Lane } from '../../types.ts';
import { useEngine, useTagMap } from '../../lib/data.ts';
import type { ArchetypeMatch } from '../../engine/comp.ts';
import { buildPlaybook, type FocusRow, type LaneMatchup, type PlayItem } from '../../engine/playbook.ts';
import type { Relation } from '../../engine/relations.ts';
import { RelationCard, TagQuotes } from '../Evidence.tsx';
import { GameIcon, HeroAvatar, LaneBadge } from '../ui.tsx';
import { LANING_NOTE, LaneDuelList } from './LaneDuels.tsx';

type Tone = 'plan' | 'opening' | 'danger' | 'build';
const TONE: Record<Tone, { dot: string; title: string }> = {
  plan: { dot: 'bg-blue', title: 'text-blue' },
  opening: { dot: 'bg-good', title: 'text-good' },
  danger: { dot: 'bg-bad', title: 'text-bad' },
  build: { dot: 'bg-gold', title: 'text-gold' },
};

export const PLAY_NOTE = '打法条目由双方阵容的官方职业和已核实技能标签触发，是通用战术说明，不是数据结论，也不代表胜率。';

function Section({ tone, title, hint, count, children }: { tone: Tone; title: string; hint?: string; count?: number; children: ReactNode }) {
  return (
    <section data-play-section={tone}>
      <div className="flex items-baseline gap-2">
        <h3 className={`text-[13.5px] font-semibold ${TONE[tone].title}`}>{title}</h3>
        {count != null && count > 0 && <span className="text-[11.5px] text-mute">{count}条</span>}
      </div>
      {hint && <p className="mt-0.5 text-[11.5px] leading-relaxed text-dim">{hint}</p>}
      <div className="mt-2 space-y-1.5">{children}</div>
    </section>
  );
}

const None = ({ children }: { children: ReactNode }) => <p className="rounded-md border border-line bg-panel2/40 px-2.5 py-2 text-[12px] text-mute">{children}</p>;

function Avatars({ heroes, ring }: { heroes: HeroData[]; ring: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {heroes.slice(0, 4).map((h) => (
        <HeroAvatar key={h.id} hero={h} size={20} ring={ring} />
      ))}
    </span>
  );
}

function Item({ item }: { item: PlayItem }) {
  const [open, setOpen] = useState(false);
  const tone = TONE[item.section];
  return (
    <div className="rounded-md border border-line bg-panel2/40" data-play={item.id}>
      <button type="button" className="flex w-full items-start gap-2 px-2.5 py-2 text-left hover:bg-panel2" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13px] font-medium text-ink">{item.title}</span>
            {item.ally.length > 0 && <Avatars heroes={item.ally.map((x) => x.hero)} ring="var(--color-blue)" />}
            {item.enemy.length > 0 && <Avatars heroes={item.enemy.map((x) => x.hero)} ring="var(--color-red)" />}
          </span>
          <span className="mt-0.5 block text-[12.5px] leading-relaxed text-sub">{item.text}</span>
          {item.items.length > 0 && (
            <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {item.items.map((i) => (
                <span key={i.id} className="inline-flex items-center gap-1 text-[12px] text-sub" title={i.desc}>
                  <GameIcon kind="item" id={i.id} name={i.name} size={22} />
                  {i.name}
                </span>
              ))}
            </span>
          )}
        </span>
        <span className={`mt-0.5 inline-block shrink-0 text-mute transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-line px-3 py-2.5">
          <p className="text-[12px] text-mute">
            <span className="text-sub">依据的通用机制：</span>
            {item.basis}
          </p>
          {item.ally.length > 0 && <HeroBasis label="我方" list={item.ally} />}
          {item.enemy.length > 0 && <HeroBasis label="对面" list={item.enemy} />}
          {item.items.length > 0 && (
            <div>
              <div className="text-[12px] text-sub">官方装备说明里带“{item.itemsKeyword}”的装备：</div>
              <ul className="mt-1 space-y-1">
                {item.items.map((i) => (
                  <li key={i.id} className="quote text-[12px]">
                    <span className="text-mute">{i.name}：</span>
                    {i.desc}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[11.5px] text-dim">这是按阵容特征触发的通用战术说明，不是数据结论。实际对局还要看经济、等级和双方操作。</p>
        </div>
      )}
    </div>
  );
}

function HeroBasis({ label, list }: { label: string; list: PlayItem['ally'] }) {
  return (
    <div>
      <div className="text-[12px] text-sub">{label}命中条件的英雄及原文依据：</div>
      {list.map((x) => (
        <TagQuotes key={x.hero.id} hero={x.hero} tags={x.tags} notes={x.notes} />
      ))}
    </div>
  );
}

function MiniHero({ hero }: { hero: HeroData }) {
  return (
    <Link to={`/heroes/${hero.id}`} className="inline-flex items-center gap-1 text-[12.5px] text-sub hover:text-blue" onClick={(e) => e.stopPropagation()}>
      <HeroAvatar hero={hero} size={20} />
      {hero.name}
    </Link>
  );
}

const PHASES: [keyof NonNullable<ArchetypeMatch['archetype']['play']>, string][] = [
  ['early', '前期'],
  ['mid', '中期'],
  ['fight', '团战'],
  ['avoid', '不要做'],
];

function OwnArchetype({ m, compact }: { m: ArchetypeMatch; compact: boolean }) {
  const play = m.archetype.play;
  const [open, setOpen] = useState(!compact);
  return (
    <div className="rounded-md border border-line bg-panel2/40 px-3 py-2.5" data-play-archetype={m.archetype.id}>
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/comps?tab=archetypes&arch=${m.archetype.id}`} className="text-[13px] font-medium text-ink hover:text-blue">
          按“{m.archetype.name}”来打
        </Link>
        <span className="text-[11.5px] text-mute">核心</span>
        {m.cores.map((h) => (
          <HeroAvatar key={h.id} hero={h} size={18} />
        ))}
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-sub">{m.archetype.winCondition}</p>
      {play && compact && (
        <button type="button" className="mt-1 text-[12px] text-blue hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? '收起分阶段打法' : '前期、中期、团战怎么打 ›'}
        </button>
      )}
      {play && open && (
        <dl className="mt-2 grid grid-cols-[3.2em_minmax(0,1fr)] gap-x-2 gap-y-1 text-[12.5px] leading-relaxed">
          {PHASES.map(([k, label]) => (
            <div key={k} className="contents">
              <dt className={k === 'avoid' ? 'text-bad' : 'text-mute'}>{label}</dt>
              <dd className="text-sub">{play[k]}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function EnemyArchetype({ m }: { m: ArchetypeMatch }) {
  if (!m.archetype.against) return null;
  return (
    <div className="rounded-md border border-line bg-panel2/40 px-3 py-2.5" data-play-against={m.archetype.id}>
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/comps?tab=archetypes&arch=${m.archetype.id}`} className="text-[13px] font-medium text-ink hover:text-blue">
          对面是“{m.archetype.name}”
        </Link>
        <span className="text-[11.5px] text-mute">核心</span>
        {m.cores.map((h) => (
          <HeroAvatar key={h.id} hero={h} size={18} ring="var(--color-red)" />
        ))}
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-sub">{m.archetype.against}</p>
    </div>
  );
}

function FocusList({ rows }: { rows: FocusRow[] }) {
  return (
    <div className="rounded-md border border-line bg-panel2/40 px-3 py-2">
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.hero.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
            <MiniHero hero={r.hero} />
            <span className="text-[12px] text-mute">被</span>
            {r.by.map((x) => (
              <span key={x.hero.id} className="inline-flex items-center gap-1 text-sub">
                <HeroAvatar hero={x.hero} size={18} />
                {x.hero.name}
                <span className="text-dim">{x.net.toFixed(2)}</span>
              </span>
            ))}
            <span className="text-[12px] text-mute">克制</span>
            <span className="ml-auto text-[11.5px] text-mute">合计 {r.total.toFixed(2)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 一条关系里最能说明问题的一句话 */
function relationSummary(r: Relation, name: (id: number) => string): string {
  const off = r.evidence.find((e) => e.kind === 'official');
  if (off && off.kind === 'official') return off.text;
  const rule = r.evidence.find((e) => e.kind === 'rule');
  if (rule && rule.kind === 'rule') return `${rule.rule.reason.replace('{a}', name(rule.aId)).replace('{b}', name(rule.bId))}。${rule.rule.condition}`;
  const com = r.evidence.find((e) => e.kind === 'commentary');
  if (com && com.kind === 'commentary') return com.item.claim;
  return '';
}

function LaneRow({ m }: { m: LaneMatchup }) {
  const { byId } = useEngine();
  const [open, setOpen] = useState(false);
  const name = (id: number) => byId.get(id)?.name ?? `#${id}`;
  const main = m.net > 0 ? m.mine : m.net < 0 ? m.theirs : (m.mine ?? m.theirs);
  const verdict =
    !m.ally || !m.enemy ? (
      <span className="text-dim">还没选</span>
    ) : m.net > 0 ? (
      <span className="text-good">我方占优 {m.net.toFixed(2)}</span>
    ) : m.net < 0 ? (
      <span className="text-bad">对面占优 {(-m.net).toFixed(2)}</span>
    ) : m.mine || m.theirs ? (
      <span className="text-warn">互有克制</span>
    ) : (
      <span className="text-mute">暂无结论</span>
    );
  const expandable = !!(m.mine || m.theirs);
  return (
    <div className="rounded-md border border-line bg-panel2/40" data-play-lane={m.lane}>
      <button type="button" className={`flex w-full flex-wrap items-center gap-2 px-2.5 py-1.5 text-left ${expandable ? 'hover:bg-panel2' : 'cursor-default'}`} aria-expanded={expandable ? open : undefined} onClick={() => expandable && setOpen(!open)}>
        <LaneBadge lane={m.lane} />
        {m.ally ? <MiniHero hero={m.ally} /> : <span className="text-[12px] text-dim">未选</span>}
        <span className="text-[11.5px] text-dim">对</span>
        {m.enemy ? <MiniHero hero={m.enemy} /> : <span className="text-[12px] text-dim">未选</span>}
        <span className="ml-auto text-[12px]">{verdict}</span>
        {expandable && <span className={`inline-block text-mute transition-transform ${open ? 'rotate-90' : ''}`}>›</span>}
      </button>
      {main && <p className="border-t border-line px-2.5 py-1.5 text-[12px] leading-relaxed text-sub">{relationSummary(main, name)}</p>}
      {open && (
        <div className="space-y-2 border-t border-line px-3 py-2.5">
          {m.mine && <RelationCard relation={m.mine} />}
          {m.theirs && <RelationCard relation={m.theirs} />}
        </div>
      )}
    </div>
  );
}

export interface PlaybookViewProps {
  ally: HeroData[];
  enemy?: HeroData[];
  allyLocks?: (Lane | null)[];
  enemyLocks?: (Lane | null)[];
  /** 只显示我方自己的打法（阵容库里没有对手时） */
  ownOnly?: boolean;
  /** 紧凑显示：体系的分阶段打法默认收起（BP助手的实战模式） */
  compact?: boolean;
}

export function PlaybookView({ ally, enemy = [], allyLocks, enemyLocks, ownOnly = false, compact = false }: PlaybookViewProps) {
  const { bundle, rel } = useEngine();
  const tagMap = useTagMap();
  const p = useMemo(
    () => buildPlaybook({ bundle, rel, tagName: (id) => tagMap.get(id)?.name ?? id }, ally, ownOnly ? [] : enemy, { allyLocks, enemyLocks }),
    [bundle, rel, tagMap, ally, enemy, ownOnly, allyLocks, enemyLocks],
  );

  if (!ally.length && !enemy.length) return <None>双方选人后，这里给出这一局怎么打：我方的打法、对面的突破口、要防的点和分路对位。</None>;

  const partial: string[] = [];
  if (ally.length > 0 && !p.complete.ally) partial.push(ally.length < 5 ? '我方还没选满' : '我方有英雄的机制档案不可用');
  if (!ownOnly && enemy.length > 0 && !p.complete.enemy) partial.push(enemy.length < 5 ? '对面还没选满' : '对面有英雄的机制档案不可用');

  return (
    <div className="space-y-4" data-testid="playbook">
      {partial.length > 0 && <p className="rounded-md border border-warn/30 bg-warn/10 px-2.5 py-1.5 text-[12px] leading-relaxed text-warn">{partial.join('，')}：“没有坦克”“没有硬控”这类“缺什么”的判断要等选满5人才显示，下面只有已经能确定的内容。</p>}

      {ally.length > 0 && (
        <Section tone="plan" title="我方怎么打" count={p.plan.length + p.allyArchetypes.length} hint={ownOnly ? '只按这套阵容自己的特征给出；和具体对手对阵时的突破口、要防的点见“阵容对比”或BP助手的“打法”。' : undefined}>
          {p.allyArchetypes.map((m) => (
            <OwnArchetype key={`${m.archetype.id}-${compact}`} m={m} compact={compact} />
          ))}
          {p.plan.map((i) => (
            <Item key={i.id} item={i} />
          ))}
          {p.plan.length + p.allyArchetypes.length === 0 && <None>{p.complete.ally ? '这套阵容没有命中已定义的体系，也没有触发打法条目。' : '已选的英雄还不足以给出打法。'}</None>}
        </Section>
      )}

      {!ownOnly && enemy.length > 0 && ally.length > 0 && (
        <>
          <Section tone="opening" title="对面的突破口" count={p.openings.length} hint="对面阵容缺什么、谁容易被处理，以及我方谁能利用。">
            {p.openings.map((i) => (
              <Item key={i.id} item={i} />
            ))}
            {p.focus.length > 0 && (
              <div data-play-focus>
                <div className="mb-1 text-[12px] text-mute">关系库里我方对它有净克制的对面英雄（数字是证据计分，不是胜率）：</div>
                <FocusList rows={p.focus} />
              </div>
            )}
            {p.openings.length + p.focus.length === 0 && <None>暂无结论：没有触发突破口条目，关系库里我方对对面也没有净克制。</None>}
          </Section>

          <Section tone="danger" title="要防的点" count={p.dangers.length + p.enemyArchetypes.filter((m) => m.archetype.against).length} hint="对面阵容的打法和关键技能，以及我方谁最容易被针对。">
            {p.enemyArchetypes.map((m) => (
              <EnemyArchetype key={m.archetype.id} m={m} />
            ))}
            {p.dangers.map((i) => (
              <Item key={i.id} item={i} />
            ))}
            {p.threats.length > 0 && (
              <div data-play-threats>
                <div className="mb-1 text-[12px] text-mute">关系库里被对面净克制的我方英雄（数字是证据计分，不是胜率）：</div>
                <FocusList rows={p.threats} />
              </div>
            )}
            {p.dangers.length + p.threats.length + p.enemyArchetypes.length === 0 && <None>暂无结论：没有触发要防的条目。</None>}
          </Section>

          {p.builds.length > 0 && (
            <Section tone="build" title="出装与召唤师技能" count={p.builds.length} hint="只在对面阵容有明确指向时给出；装备名取自官方装备说明里带对应关键词的装备。">
              {p.builds.map((i) => (
                <Item key={i.id} item={i} />
              ))}
            </Section>
          )}

          {bundle.laning && (
            <Section tone="plan" title="对线强弱与抢线" hint={`三路对线、中辅抢线、射辅对线。${LANING_NOTE}点开每一行看说法和视频出处。`}>
              <LaneDuelList ally={ally} enemy={enemy} allyLocks={allyLocks} enemyLocks={enemyLocks} />
            </Section>
          )}

          <Section tone="plan" title="分路对位（克制关系）" hint={`按双方的分路推断逐路对比；结论来自关系库（官方说明、机制推导、解说），没有依据的显示“暂无结论”。${LANE_NAME[4]}和${LANE_NAME[5]}实际是二对二，这里只比同位置。`}>
            {p.lanes.map((m) => (
              <LaneRow key={m.lane} m={m} />
            ))}
          </Section>
        </>
      )}

      {!ownOnly && ally.length > 0 && enemy.length === 0 && <None>对面还没有英雄。对面选人后，这里会给出突破口、要防的点和分路对位。</None>}
      {!ownOnly && ally.length === 0 && enemy.length > 0 && <None>我方还没有英雄。我方选人后给出打法。</None>}

      <p className="text-[11.5px] leading-relaxed text-dim">{PLAY_NOTE}点开每一条可以看到触发它的英雄和技能原文。</p>
    </div>
  );
}
