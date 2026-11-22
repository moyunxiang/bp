// 图谱共用的小工具：关系筛选、线条样式、文字宽度估算、几何检测。
import type { Evidence, Relation } from '../../engine/relations.ts';
import type { Scene } from '../../types.ts';

export const relKey = (r: Relation) => `${r.type}:${r.a}:${r.b}`;
export const sameRel = (x?: Relation | null, y?: Relation | null) => !!x && !!y && relKey(x) === relKey(y);

/** 只有已核实证据才计分；weight 为 0 的关系只有存疑证据，图上不画 */
export const isVerified = (r: Relation) => r.weight > 0 && r.evidence.length > 0;

/** 场景筛选：关系的 scenes 包含该场景或包含“全局” */
export const sceneOk = (r: Relation, scene?: Scene | null) => !scene || scene === '全局' || r.scenes.includes(scene) || r.scenes.includes('全局');

/** 证据类型筛选：关系的已核实证据中有任一指定类型 */
export const kindOk = (r: Relation, kinds?: Evidence['kind'][] | null) => !kinds || kinds.length === 0 || r.evidence.some((e) => kinds.includes(e.kind));

export const SCENE_OPTIONS: { value: '' | Scene; label: string }[] = [
  { value: '', label: '全部' },
  { value: '对线', label: '对线' },
  { value: '团战', label: '团战' },
  { value: '前期', label: '前期' },
  { value: '后期', label: '后期' },
];

export const parseScene = (s: string | null): Scene | null => (s === '对线' || s === '团战' || s === '前期' || s === '后期' ? s : null);

/** 线条粗细与不透明度随 weight 变化（weight 上限为2） */
export function edgeStyle(weight: number) {
  const w = Math.max(0, Math.min(2, weight));
  return { width: 1.2 + w * 1.5, opacity: 0.35 + 0.6 * Math.min(1, w / 1.5) };
}

/** 估算 SVG 文字宽度：中文按1em、ASCII按0.58em */
export function textWidth(s: string, fontSize: number) {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) < 0x2e80 ? 0.58 : 1;
  return w * fontSize;
}

/** 关系上的已核实证据类型，用于提示文字 */
const KIND_NAME: Record<Evidence['kind'], string> = { official: '官方', rule: '机制', kpl: '职业赛', commentary: '解说' };
export const kindNames = (r: Relation) => [...new Set(r.evidence.map((e) => KIND_NAME[e.kind]))].join('/');

/** 权重文字：不是百分比，也不是胜率 */
export const fmtWeight = (w: number) => (Math.round(w * 100) / 100).toString();

/** useId 生成的 id 可能含特殊字符，用在 url(#id) 前先清理 */
export const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '');

// ---------- 几何 ----------

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const boxesOverlap = (a: Box, b: Box, gap = 0) => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;

/** 线段与矩形是否相交（Liang–Barsky） */
export function segmentHitsBox(x0: number, y0: number, x1: number, y1: number, b: Box): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - b.x0, b.x1 - x0, y0 - b.y0, b.y1 - y0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

export function unionBox(boxes: Box[]): Box {
  return boxes.reduce((u, b) => ({ x0: Math.min(u.x0, b.x0), y0: Math.min(u.y0, b.y0), x1: Math.max(u.x1, b.x1), y1: Math.max(u.y1, b.y1) }), {
    x0: Infinity,
    y0: Infinity,
    x1: -Infinity,
    y1: -Infinity,
  });
}
