// 分路推断：把一队英雄分配到5条路，使适配权重之和最大。支持手动锁定。
import { LANES, type HeroData, type Lane } from '../types.ts';

export interface LaneSlot {
  hero: HeroData;
  /** 用户手动指定的分路 */
  locked?: Lane | null;
}

export interface LaneAssignment {
  /** 与输入同序：每个英雄被分到的路 */
  lanes: Lane[];
  /** 每个英雄在所分路上的适配权重 */
  fits: number[];
  score: number;
  /** 尚无人占用的路 */
  open: Lane[];
}

// 权重为0的分路仍可被分配（阵容可能很非常规），但要付出代价
const OFF_ROLE = -0.6;
const w = (h: HeroData, lane: Lane) => (h.lanes[lane - 1] > 0 ? h.lanes[lane - 1] : OFF_ROLE);

export function assignLanes(slots: LaneSlot[]): LaneAssignment {
  const n = slots.length;
  let best: Lane[] = [];
  let bestScore = -Infinity;
  const cur: Lane[] = [];
  const used = new Set<Lane>();

  // 锁定冲突（两人锁同一路）时，后者的锁定不生效
  const locks: (Lane | null)[] = [];
  const lockedSeen = new Set<Lane>();
  for (const s of slots) {
    if (s.locked && !lockedSeen.has(s.locked)) {
      locks.push(s.locked);
      lockedSeen.add(s.locked);
    } else locks.push(null);
  }

  const dfs = (i: number, score: number) => {
    if (i === n) {
      if (score > bestScore) {
        bestScore = score;
        best = [...cur];
      }
      return;
    }
    const options = locks[i] ? [locks[i]!] : LANES;
    for (const lane of options) {
      if (used.has(lane)) continue;
      if (!locks[i] && lockedSeen.has(lane)) continue; // 留给锁定它的人
      used.add(lane);
      cur.push(lane);
      dfs(i + 1, score + (locks[i] ? 1.5 : w(slots[i].hero, lane)));
      cur.pop();
      used.delete(lane);
    }
  };
  dfs(0, 0);

  const taken = new Set(best);
  return {
    lanes: best,
    fits: best.map((lane, i) => Math.max(0, slots[i].hero.lanes[lane - 1])),
    score: bestScore === -Infinity ? 0 : bestScore,
    open: LANES.filter((l) => !taken.has(l)),
  };
}

/**
 * 候选英雄加入队伍后的分路适配度（0–1）：
 * 允许已选英雄为它让路，取“加入后的最优分配得分 − 加入前的得分”。
 */
export function laneFitFor(candidate: HeroData, team: LaneSlot[], wantLane?: Lane | null): { fit: number; lane: Lane | null; teamLanes: Lane[] } {
  if (team.length >= 5) return { fit: 0, lane: null, teamLanes: [] };
  const before = assignLanes(team);
  const after = assignLanes([...team, { hero: candidate, locked: wantLane ?? null }]);
  const lane = after.lanes[after.lanes.length - 1] ?? null;
  // teamLanes：候选加入后，已选队友各自被分到的路（与 team 同序）
  const teamLanes = after.lanes.slice(0, team.length);
  if (wantLane) return { fit: Math.max(0, candidate.lanes[wantLane - 1]), lane: wantLane, teamLanes };
  return { fit: Math.max(0, Math.min(1, after.score - before.score)), lane, teamLanes };
}

/** 英雄权重最高的分路 */
export function primaryLane(h: HeroData): Lane {
  let best: Lane = 1;
  for (const l of LANES) if (h.lanes[l - 1] > h.lanes[best - 1]) best = l;
  return best;
}
