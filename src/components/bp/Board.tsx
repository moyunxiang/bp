// BP面板：禁用位行、双方选人列。
import { useState } from 'react';
import { LANES, LANE_NAME, type HeroData, type Lane } from '../../types.ts';
import { useEngine } from '../../lib/data.ts';
import { assignLanes } from '../../engine/lanes.ts';
import { teamFeatures } from '../../engine/comp.ts';
import { sameSlot, type DraftState, type Side, type Slot } from '../../engine/draft.ts';
import { HeroAvatar, LaneBadge } from '../ui.tsx';

const SIDE_NAME: Record<Side, string> = { blue: '蓝方', red: '红方' };
const SIDE_TEXT: Record<Side, string> = { blue: 'text-blue', red: 'text-red' };
const SIDE_BORDER: Record<Side, string> = { blue: 'border-blue/40', red: 'border-red/40' };

interface BoardProps {
  draft: DraftState;
  active: Slot | null;
  mySide: Side;
  myFloor: number | null;
  onSelect: (slot: Slot) => void;
  onClear: (slot: Slot) => void;
  onLane: (side: Side, index: number, lane: Lane | null) => void;
}

function BanSlot({ hero, active, onClick, onClear, side }: { hero: HeroData | undefined; active: boolean; onClick: () => void; onClear: () => void; side: Side }) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        aria-label={hero ? `${SIDE_NAME[side]}禁用：${hero.name}` : `${SIDE_NAME[side]}禁用位（空）`}
        className={`relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-lg border transition-colors ${
          active ? 'slot-active border-gold bg-gold/10' : hero ? 'border-line2' : `border-dashed ${SIDE_BORDER[side]} hover:border-line2 hover:bg-panel2`
        }`}
      >
        {hero ? (
          <>
            <HeroAvatar hero={hero} size={42} className="opacity-60 grayscale" />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="h-[2px] w-[130%] rotate-[-40deg] bg-bad/85" />
            </span>
          </>
        ) : (
          <span className="text-[11px] text-dim">禁</span>
        )}
      </button>
      {hero && (
        <button
          type="button"
          onClick={onClear}
          title={`移除${hero.name}`}
          className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-panel3 text-[10px] leading-none text-sub shadow group-hover:flex hover:bg-bad hover:text-white"
        >
          ×
        </button>
      )}
    </div>
  );
}

export function BanRow({ draft, active, mySide, onSelect, onClear }: BoardProps) {
  const { byId } = useEngine();
  if (draft.banPerSide === 0) return null;
  const renderSide = (side: Side) => (
    <div className={`flex items-center gap-2 ${side === 'red' ? 'flex-row-reverse' : ''}`}>
      <span className={`w-[96px] shrink-0 whitespace-nowrap text-[12px] font-medium ${SIDE_TEXT[side]} ${side === 'red' ? 'text-right' : ''}`}>
        {SIDE_NAME[side]}禁用{side === mySide && <span className="ml-1 text-mute">我方</span>}
      </span>
      <div className={`flex gap-1.5 ${side === 'red' ? 'flex-row-reverse' : ''}`}>
        {draft.bans[side].map((id, index) => {
          const slot: Slot = { side, kind: 'ban', index };
          return <BanSlot key={index} side={side} hero={id != null ? byId.get(id) : undefined} active={sameSlot(active, slot)} onClick={() => onSelect(slot)} onClear={() => onClear(slot)} />;
        })}
      </div>
    </div>
  );
  return (
    <div className="panel flex items-center justify-between px-4 py-2.5">
      {renderSide('blue')}
      <span className="text-[11px] tracking-[0.3em] text-dim">BAN</span>
      {renderSide('red')}
    </div>
  );
}

function LaneMenu({ value, auto, onChange }: { value: Lane | null; auto: Lane | null; onChange: (lane: Lane | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOpen(false)}>
      <button type="button" onClick={() => setOpen((o) => !o)} title={value ? '已手动指定分路，点击修改' : '自动推测的分路，点击修改'} className="flex items-center gap-0.5 rounded hover:brightness-125">
        {(value ?? auto) != null ? <LaneBadge lane={(value ?? auto)!} /> : <span className="chip">未定</span>}
        {value && <span className="text-[10px] text-gold">锁</span>}
      </button>
      {open && (
        <span className="absolute left-0 top-6 z-20 flex w-[84px] flex-col rounded-lg border border-line2 bg-panel2 p-1 shadow-xl">
          <button type="button" className={`rounded px-2 py-1 text-left text-[12px] hover:bg-panel3 ${value == null ? 'text-ink' : 'text-mute'}`} onClick={() => (onChange(null), setOpen(false))}>
            自动推测
          </button>
          {LANES.map((l) => (
            <button key={l} type="button" className={`rounded px-2 py-1 text-left text-[12px] hover:bg-panel3 ${value === l ? 'text-ink' : 'text-mute'}`} onClick={() => (onChange(l), setOpen(false))}>
              {LANE_NAME[l]}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

export function TeamColumn({ side, draft, active, mySide, myFloor, onSelect, onClear, onLane }: BoardProps & { side: Side }) {
  const { byId } = useEngine();
  const filled = draft.picks[side].map((id, index) => ({ id, index })).filter((x): x is { id: number; index: number } => x.id != null && byId.has(x.id));
  const assignment = assignLanes(filled.map((x) => ({ hero: byId.get(x.id)!, locked: draft.laneLocks[side][x.index] })));
  const laneOf = new Map(filled.map((x, i) => [x.index, { lane: assignment.lanes[i], fit: assignment.fits[i] }]));
  const team = filled.map((x) => byId.get(x.id)!);
  const f = teamFeatures(team);

  return (
    <div className={`panel flex flex-col overflow-hidden ${side === mySide ? '' : ''}`}>
      <div className={`flex items-center justify-between border-b border-line px-3 py-2 ${side === 'blue' ? 'bg-blue/8' : 'bg-red/8'}`}>
        <span className={`text-[13px] font-semibold ${SIDE_TEXT[side]}`}>{SIDE_NAME[side]}</span>
        <span className="text-[11.5px] text-mute">{side === mySide ? '我方' : '对方'}</span>
      </div>
      <div className="flex flex-col gap-1.5 p-2">
        {draft.picks[side].map((id, index) => {
          const slot: Slot = { side, kind: 'pick', index };
          const hero = id != null ? byId.get(id) : undefined;
          const isActive = sameSlot(active, slot);
          const isMe = side === mySide && myFloor === index + 1;
          const info = laneOf.get(index);
          return (
            <div
              key={index}
              className={`group relative flex h-[58px] items-center gap-2.5 rounded-lg border px-2 transition-colors ${
                isActive ? 'slot-active border-gold bg-gold/8' : hero ? 'border-line bg-panel2/70' : `border-dashed ${SIDE_BORDER[side]} hover:bg-panel2`
              }`}
            >
              <button type="button" onClick={() => onSelect(slot)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left" aria-label={hero ? `${SIDE_NAME[side]}${index + 1}楼：${hero.name}` : `${SIDE_NAME[side]}${index + 1}楼（空）`}>
                {hero ? (
                  <HeroAvatar hero={hero} size={42} ring={side === 'blue' ? 'rgb(76 141 255 / 0.55)' : 'rgb(255 93 93 / 0.55)'} />
                ) : (
                  <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg bg-panel2 text-[12px] text-dim">{index + 1}楼</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={`truncate text-[13.5px] ${hero ? 'font-medium text-ink' : 'text-dim'}`}>{hero ? hero.name : isActive ? '等待选择…' : '未选'}</span>
                    {isMe && <span className="shrink-0 rounded bg-gold/20 px-1 text-[10.5px] text-gold">我</span>}
                  </span>
                  {hero && <span className="block truncate text-[11px] text-mute">{index + 1}楼</span>}
                </span>
              </button>
              {hero && info && (
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <LaneMenu value={draft.laneLocks[side][index]} auto={info.lane} onChange={(lane) => onLane(side, index, lane)} />
                  {info.fit < 0.3 && !draft.laneLocks[side][index] && <span className="text-[10px] text-warn">非常规</span>}
                </span>
              )}
              {hero && (
                <button
                  type="button"
                  onClick={() => onClear(slot)}
                  title={`移除${hero.name}`}
                  className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-panel3 text-[10px] leading-none text-sub shadow group-hover:flex hover:bg-bad hover:text-white"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-auto space-y-1 border-t border-line px-3 py-2 text-[11.5px] text-mute">
        {team.length === 0 ? (
          <span className="text-dim">尚未选人</span>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
              <span title="按技能原文中物理/法术伤害的出现次数判断">
                物理<b className="ml-0.5 text-sub">{f.physical}</b> 法术<b className="ml-0.5 text-sub">{f.magic}</b>
                {f.mixed > 0 && (
                  <>
                    {' '}
                    混合<b className="ml-0.5 text-sub">{f.mixed}</b>
                  </>
                )}
              </span>
              <span title="官方主职业或副职业为坦克">
                前排<b className={`ml-0.5 ${f.frontline ? 'text-sub' : 'text-warn'}`}>{f.frontline}</b>
              </span>
              <span title="技能原文中有已核实的硬控标签">
                硬控<b className={`ml-0.5 ${f.hardCC ? 'text-sub' : 'text-warn'}`}>{f.hardCC}</b>
              </span>
            </div>
            {assignment.open.length > 0 && team.length < 5 && <div className="truncate">空缺：{assignment.open.map((l) => LANE_NAME[l]).join('、')}</div>}
          </>
        )}
      </div>
    </div>
  );
}
