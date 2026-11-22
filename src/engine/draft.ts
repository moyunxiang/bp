// BP状态与规则。纯数据 + 纯函数，便于撤销重做和测试。
import type { HeroData, Lane } from '../types.ts';

export type Side = 'blue' | 'red';
export const other = (s: Side): Side => (s === 'blue' ? 'red' : 'blue');
export type Mode = 'ranked' | 'peak' | 'free';

export interface Slot {
  side: Side;
  kind: 'ban' | 'pick';
  index: number;
}

export interface DraftState {
  mode: Mode;
  /** 每方禁用位数量 */
  banPerSide: number;
  bans: Record<Side, (number | null)[]>;
  picks: Record<Side, (number | null)[]>;
  /** 手动指定的分路，与 picks 同下标 */
  laneLocks: Record<Side, (Lane | null)[]>;
  /** 手动选中的槽位；为空时按规则顺序走 */
  cursor: Slot | null;
}

export const MODE_INFO: Record<Mode, { name: string; desc: string; banPerSide: number }> = {
  ranked: { name: '排位赛', desc: '双方同时禁用（可重复），然后按 蓝1 → 红2 → 蓝2 → 红2 → 蓝2 → 红1 选人', banPerSide: 5 },
  peak: { name: '巅峰赛', desc: '每人禁用1个（同时进行，可重复），选人顺序同排位', banPerSide: 5 },
  free: { name: '自由模拟', desc: '不限顺序，点哪个位置填哪个位置', banPerSide: 5 },
};

/** 选人顺序：蓝1 → 红1红2 → 蓝2蓝3 → 红3红4 → 蓝4蓝5 → 红5（无官方文本确认，为通行顺序） */
export const PICK_ORDER: Slot[] = [
  ['blue', 0],
  ['red', 0],
  ['red', 1],
  ['blue', 1],
  ['blue', 2],
  ['red', 2],
  ['red', 3],
  ['blue', 3],
  ['blue', 4],
  ['red', 4],
].map(([side, index]) => ({ side: side as Side, kind: 'pick' as const, index: index as number }));

export function newDraft(mode: Mode = 'ranked', banPerSide = MODE_INFO[mode].banPerSide): DraftState {
  const n = Math.max(0, Math.min(5, banPerSide));
  return {
    mode,
    banPerSide: n,
    bans: { blue: Array(n).fill(null), red: Array(n).fill(null) },
    picks: { blue: Array(5).fill(null), red: Array(5).fill(null) },
    laneLocks: { blue: Array(5).fill(null), red: Array(5).fill(null) },
    cursor: null,
  };
}

/** 规则顺序：先填完所有禁用位（蓝方在前，实际为同时进行），再按选人顺序。 */
export function sequence(d: DraftState): Slot[] {
  const bans: Slot[] = [];
  for (const side of ['blue', 'red'] as Side[]) for (let i = 0; i < d.banPerSide; i++) bans.push({ side, kind: 'ban', index: i });
  return [...bans, ...PICK_ORDER];
}

export const slotValue = (d: DraftState, s: Slot) => (s.kind === 'ban' ? d.bans[s.side][s.index] : d.picks[s.side][s.index]);
export const sameSlot = (a: Slot | null, b: Slot | null) => !!a && !!b && a.side === b.side && a.kind === b.kind && a.index === b.index;

/** 当前应该填写的槽位：手动选中的优先，否则是规则顺序里第一个空位。全部填完返回 null。 */
export function activeSlot(d: DraftState): Slot | null {
  if (d.cursor) return d.cursor;
  return sequence(d).find((s) => slotValue(d, s) == null) ?? null;
}

export const pickedIds = (d: DraftState, side: Side) => d.picks[side].filter((x): x is number => x != null);
export const bannedIds = (d: DraftState) => [...d.bans.blue, ...d.bans.red].filter((x): x is number => x != null);
export const isComplete = (d: DraftState) => sequence(d).every((s) => slotValue(d, s) != null);

export type Unavailable = 'banned' | 'picked' | 'group' | 'limited' | null;

/**
 * 英雄在某个槽位是否可用。
 * - 已被任一方选走：不可再选；可以被禁（没有意义但不拦）。
 * - 已被禁：不可选；同时禁用阶段双方可以重复禁同一个英雄，但同一方不重复。
 * - 同一互斥组（多形态英雄）已有成员被选：其余成员不可选。
 * - 限时英雄：排位/巅峰模式不可用。
 */
export function unavailableReason(d: DraftState, hero: HeroData, slot: Slot, byId: Map<number, HeroData>): Unavailable {
  if (hero.isLimited && d.mode !== 'free') return 'limited';
  const current = slotValue(d, slot);
  const picked = [...d.picks.blue, ...d.picks.red].filter((x): x is number => x != null && x !== current);
  if (slot.kind === 'pick') {
    if (bannedIds(d).includes(hero.id)) return 'banned';
    if (picked.includes(hero.id)) return 'picked';
    if (hero.groupId && picked.some((id) => byId.get(id)?.groupId === hero.groupId)) return 'group';
  } else {
    if (d.bans[slot.side].some((x, i) => x === hero.id && i !== slot.index)) return 'banned';
    if (picked.includes(hero.id)) return 'picked';
  }
  return null;
}

/** 在槽位填入英雄（不校验可用性，由调用方先检查）。填完后光标回到规则顺序。 */
export function place(d: DraftState, slot: Slot, heroId: number | null): DraftState {
  const next: DraftState = {
    ...d,
    bans: { blue: [...d.bans.blue], red: [...d.bans.red] },
    picks: { blue: [...d.picks.blue], red: [...d.picks.red] },
    laneLocks: { blue: [...d.laneLocks.blue], red: [...d.laneLocks.red] },
    cursor: null,
  };
  if (slot.kind === 'ban') next.bans[slot.side][slot.index] = heroId;
  else {
    next.picks[slot.side][slot.index] = heroId;
    next.laneLocks[slot.side][slot.index] = null;
  }
  return next;
}

export function setLaneLock(d: DraftState, side: Side, index: number, lane: Lane | null): DraftState {
  const laneLocks = { blue: [...d.laneLocks.blue], red: [...d.laneLocks.red] };
  // 同队只能有一人锁定某条路
  if (lane) laneLocks[side] = laneLocks[side].map((l) => (l === lane ? null : l));
  laneLocks[side][index] = lane;
  return { ...d, laneLocks };
}

export function setBanCount(d: DraftState, n: number): DraftState {
  const resize = (arr: (number | null)[]) => Array.from({ length: n }, (_, i) => arr[i] ?? null);
  return { ...d, banPerSide: n, bans: { blue: resize(d.bans.blue), red: resize(d.bans.red) }, cursor: null };
}

/** 规则顺序中，某一方在当前槽位之后（含当前）还要选几个人 */
export function picksRemaining(d: DraftState, side: Side) {
  return d.picks[side].filter((x) => x == null).length;
}

/** 在对方下一次轮到选人之前，这一方连续还能选几个（用于判断是否需要一次考虑两手） */
export function picksInThisTurn(d: DraftState, side: Side): number {
  const seq = PICK_ORDER.filter((s) => slotValue(d, s) == null);
  let n = 0;
  for (const s of seq) {
    if (s.side !== side) break;
    n++;
  }
  return n;
}

/** 某一方在对方之后是否还有选人机会（没有则不必考虑“暴露”风险） */
export function enemyCanStillRespond(d: DraftState, side: Side): boolean {
  return d.picks[other(side)].some((x) => x == null);
}
