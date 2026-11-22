// 推荐面板：选人推荐、禁用推荐、候选对比、双方关系。
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { HeroData } from '../../types.ts';
import { PART_NAME, type BanRecommendation, type Part, type ReasonItem, type Recommendation } from '../../engine/recommend.ts';
import type { Relation } from '../../engine/relations.ts';
import { ConfidenceBadge, Delta, Empty, HeroAvatar, LaneBadge } from '../ui.tsx';
import { EvidenceList, KindBadges, RelationCard } from '../Evidence.tsx';
import { TeamGraph } from '../TeamGraph.tsx';

export type RecTab = 'pick' | 'ban' | 'compare' | 'matchup' | 'play';

function ScoreBadge({ score }: { score: number }) {
  return (
    <span className="flex w-[42px] shrink-0 flex-col items-center leading-none" title="推荐分：各分项之和，不是胜率">
      <span className="text-[20px] font-semibold text-gold">{score}</span>
      <span className="mt-0.5 text-[10px] text-dim">推荐分</span>
    </span>
  );
}

function ReasonRow({ item, research }: { item: ReasonItem; research: boolean }) {
  const [open, setOpen] = useState(false);
  const expandable = research && !!item.relation;
  return (
    <li>
      <div className="flex items-start gap-2 text-[12.5px]">
        <span className="w-9 shrink-0 text-right">
          <Delta value={item.delta} />
        </span>
        <span className="min-w-0 flex-1 text-sub">
          {item.text}
          {item.relation && (
            <span className="ml-1.5 inline-flex align-middle">
              <KindBadges relation={item.relation} />
            </span>
          )}
        </span>
        {expandable && (
          <button type="button" className="shrink-0 text-[11.5px] text-mute hover:text-blue" onClick={() => setOpen((o) => !o)}>
            {open ? '收起' : '依据'}
          </button>
        )}
      </div>
      {open && item.relation && (
        <div className="ml-11 mt-1.5 rounded-lg border border-line bg-bg/60 p-2.5">
          <EvidenceList relation={item.relation} />
        </div>
      )}
    </li>
  );
}

function PartBlock({ part, research }: { part: Part; research: boolean }) {
  if (!part.items.length && !part.value) return null;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px]">
        <span className="text-mute">{PART_NAME[part.key]}</span>
        <Delta value={part.value} />
      </div>
      <ul className="space-y-1">
        {part.items
          .filter((i) => i.text)
          .map((item, i) => (
            <ReasonRow key={i} item={item} research={research} />
          ))}
      </ul>
    </div>
  );
}

interface PickListProps {
  recs: Recommendation[];
  limit: number;
  research: boolean;
  compare: number[];
  onToggleCompare: (id: number) => void;
  onPick: (hero: HeroData) => void;
  canPick: boolean;
  emptyText: string;
}

export function PickList({ recs, limit, research, compare, onToggleCompare, onPick, canPick, emptyText }: PickListProps) {
  const [openId, setOpenId] = useState<number | null>(null);
  if (!recs.length) return <Empty>{emptyText}</Empty>;
  return (
    <ol className="space-y-1.5">
      {recs.slice(0, limit).map((r, i) => {
        const open = openId === r.hero.id;
        return (
          <li key={r.hero.id} className={`rounded-lg border transition-colors ${open ? 'border-line2 bg-panel2' : 'border-line bg-panel2/50 hover:border-line2'}`}>
            <div className="flex items-center gap-2.5 px-2.5 py-2">
              <span className="kbd shrink-0" title={`按数字键 ${i + 1} 直接选用`}>
                {i < 9 ? i + 1 : '·'}
              </span>
              <button type="button" onClick={() => setOpenId(open ? null : r.hero.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left" aria-expanded={open}>
                <HeroAvatar hero={r.hero} size={38} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[14px] font-medium">{r.hero.name}</span>
                    {r.lane && <LaneBadge lane={r.lane} />}
                    <ConfidenceBadge level={r.confidence} title={r.confidenceNote} />
                  </span>
                  <span className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-mute">{r.headline}</span>
                </span>
              </button>
              <ScoreBadge score={r.score} />
              <span className="flex shrink-0 flex-col gap-1">
                <button type="button" className="btn btn-primary btn-sm" disabled={!canPick} onClick={() => onPick(r.hero)}>
                  选用
                </button>
                <button type="button" className={`btn btn-sm ${compare.includes(r.hero.id) ? '!border-gold !text-gold' : ''}`} onClick={() => onToggleCompare(r.hero.id)} aria-pressed={compare.includes(r.hero.id)}>
                  {compare.includes(r.hero.id) ? '已加入' : '对比'}
                </button>
              </span>
            </div>
            {open && (
              <div className="space-y-3 border-t border-line px-3 py-2.5">
                <p className="text-[12px] text-mute">
                  可信程度：{r.confidenceNote}。
                  <Link to={`/heroes/${r.hero.id}`} className="ml-1 text-blue hover:underline">
                    查看英雄详情
                  </Link>
                </p>
                {r.parts.map((p) => (
                  <PartBlock key={p.key} part={p} research={research} />
                ))}
                {r.threats.length > 0 && (
                  <div className="rounded-lg bg-bg/60 px-2.5 py-2 text-[12.5px]">
                    <span className="text-mute">选它之后要防（可考虑禁用或抢先选走）：</span>
                    <span className="mt-1 flex flex-wrap gap-2">
                      {r.threats.map((t) => (
                        <span key={t.hero.id} className="inline-flex items-center gap-1 text-sub">
                          <HeroAvatar hero={t.hero} size={18} />
                          {t.hero.name}
                        </span>
                      ))}
                    </span>
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function BanList({ recs, limit, research, onPick, canPick, emptyText }: { recs: BanRecommendation[]; limit: number; research: boolean; onPick: (hero: HeroData) => void; canPick: boolean; emptyText: string }) {
  const [openId, setOpenId] = useState<number | null>(null);
  if (!recs.length) return <Empty>{emptyText}</Empty>;
  return (
    <ol className="space-y-1.5">
      {recs.slice(0, limit).map((r, i) => {
        const open = openId === r.hero.id;
        return (
          <li key={r.hero.id} className={`rounded-lg border transition-colors ${open ? 'border-line2 bg-panel2' : 'border-line bg-panel2/50 hover:border-line2'}`}>
            <div className="flex items-center gap-2.5 px-2.5 py-2">
              <span className="kbd shrink-0">{i < 9 ? i + 1 : '·'}</span>
              <button type="button" onClick={() => setOpenId(open ? null : r.hero.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left" aria-expanded={open}>
                <HeroAvatar hero={r.hero} size={38} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[14px] font-medium">{r.hero.name}</span>
                    <ConfidenceBadge level={r.confidence} title="依据的已核实关系越多，可信程度越高" />
                  </span>
                  <span className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-mute">{r.headline}</span>
                </span>
              </button>
              <ScoreBadge score={r.score} />
              <button type="button" className="btn btn-sm shrink-0 !border-bad/60 !text-bad hover:!bg-bad/15" disabled={!canPick} onClick={() => onPick(r.hero)}>
                禁用
              </button>
            </div>
            {open && (
              <ul className="space-y-1 border-t border-line px-3 py-2.5">
                {r.items.map((item, k) => (
                  <ReasonRow key={k} item={item} research={research} />
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function CompareTable({ recs, ids, onRemove, onPick, canPick }: { recs: Recommendation[]; ids: number[]; onRemove: (id: number) => void; onPick: (hero: HeroData) => void; canPick: boolean }) {
  const rows = ids.map((id) => recs.find((r) => r.hero.id === id)).filter((r): r is Recommendation => !!r);
  if (!rows.length) return <Empty>在推荐列表里点“对比”，最多加入4个候选，这里会并排显示它们的各项得分和理由。</Empty>;
  const keys = [...new Set(rows.flatMap((r) => r.parts.map((p) => p.key)))];
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-[12.5px]">
        <thead>
          <tr>
            <th className="w-[72px]" />
            {rows.map((r) => (
              <th key={r.hero.id} className="px-1.5 pb-2 text-center font-normal">
                <div className="flex flex-col items-center gap-1">
                  <HeroAvatar hero={r.hero} size={40} />
                  <span className="text-[13px] font-medium">{r.hero.name}</span>
                  <span className="text-[18px] font-semibold leading-none text-gold">{r.score}</span>
                  <ConfidenceBadge level={r.confidence} title={r.confidenceNote} />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k}>
              <td className="border-t border-line py-1.5 pr-2 text-mute">{PART_NAME[k]}</td>
              {rows.map((r) => {
                const part = r.parts.find((p) => p.key === k);
                return (
                  <td key={r.hero.id} className="border-t border-line px-1.5 py-1.5 text-center align-top">
                    <div>
                      <Delta value={part?.value ?? 0} />
                    </div>
                    <div className="mt-0.5 space-y-0.5 text-left text-[11.5px] leading-snug text-mute">
                      {part?.items
                        .filter((i) => i.text && Math.abs(i.delta) >= 0.3)
                        .slice(0, 3)
                        .map((i, n) => (
                          <div key={n}>{i.text.replace(/（.*?）/g, '')}</div>
                        ))}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <td className="border-t border-line py-2" />
            {rows.map((r) => (
              <td key={r.hero.id} className="border-t border-line px-1.5 py-2 text-center">
                <div className="flex flex-col items-center gap-1">
                  <button type="button" className="btn btn-primary btn-sm" disabled={!canPick} onClick={() => onPick(r.hero)}>
                    选用
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRemove(r.hero.id)}>
                    移出
                  </button>
                </div>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-[11.5px] text-dim">推荐分是各分项之和，不是胜率。差距在2分以内时可以认为两者相当，按自己的熟练度选。</p>
    </div>
  );
}

export function Matchup({ blue, red }: { blue: HeroData[]; red: HeroData[] }) {
  const [selected, setSelected] = useState<Relation | null>(null);
  if (!blue.length && !red.length) return <Empty>双方选人后，这里显示两套阵容之间的克制关系和各自的队内配合。</Empty>;
  const href = `/graph?mode=team&blue=${blue.map((h) => h.id).join(',')}&red=${red.map((h) => h.id).join(',')}`;
  return (
    <div className="space-y-3">
      <TeamGraph blue={blue} red={red} selected={selected} onSelect={setSelected} />
      {selected ? <RelationCard relation={selected} /> : <p className="text-center text-[12px] text-mute">点击连线查看这条关系的依据和成立条件</p>}
      <div className="text-right">
        <Link to={href} className="text-[12px] text-blue hover:underline">
          在关系图谱中打开，可按场景筛选
        </Link>
      </div>
    </div>
  );
}
