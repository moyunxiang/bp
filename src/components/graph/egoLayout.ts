// 单英雄图谱的布局：中心英雄 + 三个120°扇区。
//
// 每个扇区内 n 个节点按角度均分成 n 个格子，格子轮流落在 L 个半径层上（L=1..3，内层放权重高的）。
// 对每个 L 从小到大搜索内层半径 r，直到同时满足：
//   1. 节点（头像+名字的外接矩形）互不重叠，也不与中心节点、其他扇区节点重叠；
//   2. 节点矩形完全落在本扇区的楔形内（扇区之间界线清楚）；
//   3. 中心到每个节点的连线不穿过任何其他节点的头像（名字有底色描边，线可以从名字下方经过）。
// 取最外缘最小的方案。扇区标题放在楔形外侧的中线上。坐标以中心英雄为原点，viewBox 由所有元素的外接框决定。
import { boxesOverlap, segmentHitsBox, unionBox, type Box } from './shared.ts';

export type SectorId = 'counters' | 'counteredBy' | 'synergy';
export const SECTOR_IDS: SectorId[] = ['counteredBy', 'counters', 'synergy'];

const deg = (d: number) => (d * Math.PI) / 180;
/** 扇区中线角度（SVG 坐标，y 向下）：被克制在左上、克制在右上、配合在下方 */
export const SECTOR_MID: Record<SectorId, number> = { counteredBy: deg(-150), counters: deg(-30), synergy: deg(90) };
const WEDGE_HALF = deg(58.5);
const SLOT_SPAN = deg(108);

export interface EgoDims {
  avatar: number;
  font: number;
  labelWidth: number;
  centerAvatar: number;
  centerFont: number;
  centerLabelWidth: number;
  titleFont: number;
}

export interface Pt {
  x: number;
  y: number;
}

export interface SectorGeom {
  mid: number;
  /** 楔形背景的半径 */
  wedgeR: number;
  /** 标题第一行基线位置（居中对齐） */
  title: Pt;
  /** 扇区为空时“暂无结论”的位置 */
  empty: Pt;
}

export interface EgoLayout {
  /** 与传入的节点顺序（按 weight 降序）一一对应 */
  nodes: Record<SectorId, Pt[]>;
  sectors: Record<SectorId, SectorGeom>;
  viewBox: Box;
}

/** 节点外接矩形；lw 为该节点名字的实际宽度（不超过 d.labelWidth） */
export function nodeBox(p: Pt, d: EgoDims, lw = d.labelWidth): Box {
  const hw = Math.max(d.avatar, Math.min(lw, d.labelWidth)) / 2 + 4;
  return { x0: p.x - hw, x1: p.x + hw, y0: p.y - d.avatar / 2 - 4, y1: p.y + d.avatar / 2 + d.font + 8 };
}

export function centerBox(d: EgoDims): Box {
  const hw = Math.max(d.centerAvatar, d.centerLabelWidth) / 2 + 4;
  return { x0: -hw, x1: hw, y0: -d.centerAvatar / 2 - 5, y1: d.centerAvatar / 2 + d.centerFont + 9 };
}

const corners = (b: Box): Pt[] => [
  { x: b.x0, y: b.y0 },
  { x: b.x1, y: b.y0 },
  { x: b.x0, y: b.y1 },
  { x: b.x1, y: b.y1 },
];

const angleDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

const inWedge = (b: Box, mid: number) => corners(b).every((c) => Math.abs(angleDiff(Math.atan2(c.y, c.x), mid)) <= WEDGE_HALF);

const farthest = (b: Box) => Math.max(...corners(b).map((c) => Math.hypot(c.x, c.y)));

/** 矩形上离原点最近的点到原点的距离 */
const nearest = (b: Box) => Math.hypot(Math.max(b.x0, Math.min(0, b.x1)), Math.max(b.y0, Math.min(0, b.y1)));

interface Seg {
  x: number;
  y: number;
}

function slots(n: number, mid: number, r: number, levels: number, dR: number): Pt[] {
  const out: Pt[] = [];
  for (let j = 0; j < n; j++) {
    const a = mid - SLOT_SPAN / 2 + ((j + 0.5) * SLOT_SPAN) / n;
    const rr = r + (j % levels) * dR;
    out.push({ x: rr * Math.cos(a), y: rr * Math.sin(a) });
  }
  return out;
}

function valid(pts: Pt[], lws: number[], mid: number, d: EgoDims, placed: Box[], placedSegs: Seg[]): boolean {
  const boxes = pts.map((p, i) => nodeBox(p, d, lws[i]));
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (!inWedge(b, mid)) return false;
    for (const q of placed) if (boxesOverlap(b, q, 4)) return false;
    for (let j = i + 1; j < boxes.length; j++) if (boxesOverlap(b, boxes[j], 4)) return false;
    // 已放置扇区的连线不能穿过新节点的头像
    const ab = avatarBox(pts[i], d);
    for (const s of placedSegs) if (segmentHitsBox(0, 0, s.x, s.y, ab)) return false;
  }
  // 本扇区的连线不能穿过任何其他节点的头像（名字带描边底色，允许线从名字下方经过）
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    for (let j = 0; j < pts.length; j++) if (j !== i && segmentHitsBox(0, 0, p.x, p.y, avatarBox(pts[j], d))) return false;
    for (const q of placedSegs) if (segmentHitsBox(0, 0, p.x, p.y, avatarBox(q, d))) return false;
  }
  return true;
}

/** 头像外接矩形（含选中外框），连线需要避开 */
const avatarBox = (p: Pt, d: EgoDims): Box => {
  const h = d.avatar / 2 + 5;
  return { x0: p.x - h, x1: p.x + h, y0: p.y - h, y1: p.y + h };
};

/** 格子顺序：第 k 个按 weight 排序的节点放在第 order[k] 个格子（内层格子先放权重高的） */
function slotOrder(n: number, levels: number): number[] {
  const order: number[] = [];
  for (let l = 0; l < levels; l++) for (let j = l; j < n; j += levels) order.push(j);
  return order;
}

/** lws：按 weight 降序排列的各节点名字宽度。返回与之对应的坐标 */
function placeSector(lws: number[], mid: number, d: EgoDims, placed: Box[], placedSegs: Seg[]): Pt[] {
  const n = lws.length;
  if (n === 0) return [];
  const dR = d.avatar + d.font + 26;
  const rMin = Math.max(d.centerAvatar, d.centerLabelWidth) / 2 + d.avatar / 2 + 30;
  let best: { pts: Pt[]; outer: number; levels: number } | null = null;
  for (let levels = 1; levels <= Math.min(3, n); levels++) {
    const order = slotOrder(n, levels);
    // 格子 j 上的节点名字宽度
    const slotLw: number[] = [];
    order.forEach((j, k) => (slotLw[j] = lws[k]));
    for (let r = rMin; r <= 1600; r += 6) {
      const pts = slots(n, mid, r, levels, dR);
      if (!valid(pts, slotLw, mid, d, placed, placedSegs)) continue;
      const outer = Math.max(...pts.map((p, j) => farthest(nodeBox(p, d, slotLw[j]))));
      if (!best || outer < best.outer - 8) best = { pts: order.map((j) => pts[j]), outer, levels };
      break;
    }
  }
  // 理论上不会走到兜底：单层大半径
  return best ? best.pts : slots(n, mid, 1600, 1, dR);
}

/** labelWidths：每个扇区按 weight 降序排列的节点名字宽度 */
export function layoutEgo(labelWidths: Record<SectorId, number[]>, d: EgoDims): EgoLayout {
  const cBox = centerBox(d);
  const placed: Box[] = [cBox];
  const segs: Seg[] = [];
  const nodes = {} as Record<SectorId, Pt[]>;

  // 节点多的扇区先放，给它更自由的空间
  const order = [...SECTOR_IDS].sort((a, b) => labelWidths[b].length - labelWidths[a].length);
  for (const s of order) {
    const lws = labelWidths[s];
    const pts = placeSector(lws, SECTOR_MID[s], d, placed, segs);
    nodes[s] = pts;
    pts.forEach((p, i) => {
      placed.push(nodeBox(p, d, lws[i]));
      segs.push(p);
    });
  }

  const all: Box[] = [...placed];
  const sectors = {} as Record<SectorId, SectorGeom>;
  const emptyR = Math.max(d.centerAvatar, d.centerLabelWidth) / 2 + 70;
  const tf = d.titleFont;
  for (const s of SECTOR_IDS) {
    const mid = SECTOR_MID[s];
    const pts = nodes[s];
    const outer = pts.length ? Math.max(...pts.map((p, i) => farthest(nodeBox(p, d, labelWidths[s][i])))) : emptyR + 50;
    const wedgeR = outer + 10;
    // 标题：两行（标题 + 数量说明），宽度按12个字估计
    const hw = tf * 4.6;
    const hh = tf * 1.25;
    let R = wedgeR;
    let tb: Box = { x0: 0, y0: 0, x1: 0, y1: 0 };
    for (; R < wedgeR + 600; R += 4) {
      const cx = R * Math.cos(mid);
      const cy = R * Math.sin(mid);
      tb = { x0: cx - hw, x1: cx + hw, y0: cy - hh, y1: cy + hh };
      if (nearest(tb) >= wedgeR + 6 && !placed.some((b) => boxesOverlap(b, tb, 4))) break;
    }
    const title = { x: (tb.x0 + tb.x1) / 2, y: tb.y0 + tf };
    const empty = { x: emptyR * Math.cos(mid), y: emptyR * Math.sin(mid) };
    all.push(tb);
    if (!pts.length) all.push({ x0: empty.x - 60, x1: empty.x + 60, y0: empty.y - 20, y1: empty.y + 24 });
    // 楔形弧线外缘
    for (let k = 0; k <= 12; k++) {
      const a = mid - WEDGE_HALF + (k * 2 * WEDGE_HALF) / 12;
      const x = wedgeR * Math.cos(a);
      const y = wedgeR * Math.sin(a);
      all.push({ x0: x, x1: x, y0: y, y1: y });
    }
    sectors[s] = { mid, wedgeR, title, empty };
  }
  const u = unionBox(all);
  const pad = 10;
  return { nodes, sectors, viewBox: { x0: u.x0 - pad, y0: u.y0 - pad, x1: u.x1 + pad, y1: u.y1 + pad } };
}

/** 楔形背景路径 */
export function wedgePath(mid: number, r: number): string {
  const a0 = mid - WEDGE_HALF;
  const a1 = mid + WEDGE_HALF;
  const p0 = `${(r * Math.cos(a0)).toFixed(1)} ${(r * Math.sin(a0)).toFixed(1)}`;
  const p1 = `${(r * Math.cos(a1)).toFixed(1)} ${(r * Math.sin(a1)).toFixed(1)}`;
  return `M0 0 L${p0} A${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${p1} Z`;
}
