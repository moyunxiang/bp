// 阵容对阵关系图：蓝方在左列、红方在右列。
// 跨队克制画成带箭头的连线（克制方指向被克制方；蓝方占优为蓝色，红方占优为红色），
// 同队配合画成列外侧的绿色弧线。线的粗细与不透明度反映 weight。SVG 用 viewBox 自适应宽度。
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import type { HeroData, Scene } from '../types.ts';
import type { Relation } from '../engine/relations.ts';
import { useEngine } from '../lib/data.ts';
import { teamRelations } from './graph/teamRelations.ts';
import { edgeStyle, fmtWeight, kindNames, relKey, safeId } from './graph/shared.ts';
import { SvgHeroNode } from './graph/SvgHeroNode.tsx';
import { Empty } from './ui.tsx';

export interface TeamGraphProps {
  blue: HeroData[];
  red: HeroData[];
  /** 只显示适用于该场景的关系；为空显示全部 */
  scene?: Scene | null;
  onSelect?: (relation: Relation) => void;
  selected?: Relation | null;
}

const W = 500;
const X_BLUE = 140;
const X_RED = 360;
const AV = 40;
const ROW_H = 80;
const TOP = 62; // 第一行头像中心
const FONT = 12;
const LABEL_W = 78;

/** 第 i 个节点的纵坐标：人数少的一方在纵向居中 */
const yAt = (i: number, n: number, rows: number) => TOP + (i + (rows - n) / 2) * ROW_H;

type Tone = 'blue' | 'red' | 'good';
const STROKE: Record<Tone, string> = { blue: 'stroke-blue', red: 'stroke-red', good: 'stroke-good' };
const FILL: Record<Tone, string> = { blue: 'fill-blue', red: 'fill-red', good: 'fill-good' };

interface Edge {
  key: string;
  relation: Relation;
  tone: Tone;
  d: string;
  /** 两端英雄（节点 key：side-id） */
  ends: [string, string];
  arrow: boolean;
  label: string;
}

type Hover = { edge: string } | { node: string } | null;

export function TeamGraph({ blue, red, scene, onSelect, selected }: TeamGraphProps) {
  const engine = useEngine();
  const uid = safeId(useId());
  const [hover, setHover] = useState<Hover>(null);

  const rows = Math.max(blue.length, red.length, 1);
  const H = TOP + (rows - 1) * ROW_H + AV / 2 + FONT + 18;

  const tr = useMemo(() => teamRelations(engine.rel, blue, red, scene), [engine, blue, red, scene]);

  const edges = useMemo(() => {
    const out: Edge[] = [];
    const bIdx = new Map(blue.map((h, i) => [h.id, i]));
    const rIdx = new Map(red.map((h, i) => [h.id, i]));
    const name = (id: number) => engine.byId.get(id)?.name ?? `#${id}`;
    const shownPairs = new Set([...tr.blueCounters, ...tr.redCounters].map((r) => `${r.a}>${r.b}`));
    // 同一对英雄的多条线在两端错开一点，避免箭头重叠
    const off = (k: number, n: number) => (k - (n - 1) / 2) * 4.5;
    const xb = X_BLUE + AV / 2 + 5;
    const xr = X_RED - AV / 2 - 5;

    const cross = (r: Relation, fromBlue: boolean) => {
      const bi = bIdx.get(fromBlue ? r.a : r.b)!;
      const ri = rIdx.get(fromBlue ? r.b : r.a)!;
      const pb = { x: xb, y: yAt(bi, blue.length, rows) + off(ri, red.length) };
      const pr = { x: xr, y: yAt(ri, red.length, rows) + off(bi, blue.length) };
      const [s, e] = fromBlue ? [pb, pr] : [pr, pb];
      const both = shownPairs.has(`${r.b}>${r.a}`);
      let d = `M${s.x} ${s.y} L${e.x} ${e.y}`;
      if (both) {
        // 双向都有克制：各自向行进方向的左侧弯曲，两条线自然分开
        const dx = e.x - s.x;
        const dy = e.y - s.y;
        const len = Math.hypot(dx, dy) || 1;
        const cx = (s.x + e.x) / 2 + (dy / len) * 14;
        const cy = (s.y + e.y) / 2 - (dx / len) * 14;
        d = `M${s.x} ${s.y} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${e.x} ${e.y}`;
      }
      out.push({
        key: relKey(r),
        relation: r,
        tone: fromBlue ? 'blue' : 'red',
        d,
        ends: [`${fromBlue ? 'b' : 'r'}-${r.a}`, `${fromBlue ? 'r' : 'b'}-${r.b}`],
        arrow: true,
        label: `${name(r.a)}克制${name(r.b)}（${fromBlue ? '蓝方' : '红方'}占优），权重${fmtWeight(r.weight)}，证据：${kindNames(r)}`,
      });
    };

    const arc = (r: Relation, side: 'b' | 'r') => {
      const team = side === 'b' ? blue : red;
      const idx = side === 'b' ? bIdx : rIdx;
      let i = idx.get(r.a)!;
      let j = idx.get(r.b)!;
      if (i > j) [i, j] = [j, i];
      const yi = yAt(i, team.length, rows) + 4;
      const yj = yAt(j, team.length, rows) - 4;
      const dir = side === 'b' ? -1 : 1;
      const ax = side === 'b' ? X_BLUE - AV / 2 - 4 : X_RED + AV / 2 + 4;
      const bulge = (14 + 13 * (j - i)) / 0.75;
      const cx = ax + dir * bulge;
      out.push({
        key: relKey(r),
        relation: r,
        tone: 'good',
        d: `M${ax} ${yi} C${cx} ${yi} ${cx} ${yj} ${ax} ${yj}`,
        ends: [`${side}-${r.a}`, `${side}-${r.b}`],
        arrow: false,
        label: `${name(r.a)}与${name(r.b)}配合（${side === 'b' ? '蓝方' : '红方'}队内），权重${fmtWeight(r.weight)}，证据：${kindNames(r)}`,
      });
    };

    tr.blueSynergy.forEach((r) => arc(r, 'b'));
    tr.redSynergy.forEach((r) => arc(r, 'r'));
    // 权重低的先画，权重高的在上层
    [...tr.blueCounters.map((r) => [r, true] as const), ...tr.redCounters.map((r) => [r, false] as const)]
      .sort((x, y) => x[0].weight - y[0].weight)
      .forEach(([r, fb]) => cross(r, fb));
    return out;
  }, [engine, blue, red, tr, rows]);

  if (!blue.length && !red.length) return <Empty>双方都还没有选择英雄，暂无结论。</Empty>;

  const selKey = selected ? relKey(selected) : null;
  // 悬停时需要高亮的边与节点
  let hotEdges: Set<string> | null = null;
  let hotNodes: Set<string> | null = null;
  if (hover) {
    hotEdges = new Set();
    hotNodes = new Set();
    if ('edge' in hover) {
      const e = edges.find((x) => x.key === hover.edge);
      if (e) {
        hotEdges.add(e.key);
        e.ends.forEach((n) => hotNodes!.add(n));
      }
    } else {
      hotNodes.add(hover.node);
      for (const e of edges)
        if (e.ends.includes(hover.node)) {
          hotEdges.add(e.key);
          e.ends.forEach((n) => hotNodes!.add(n));
        }
    }
  }

  const handleKey = (ev: KeyboardEvent, r: Relation) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      onSelect?.(r);
    }
  };

  const noEdges = edges.length === 0;
  const both = blue.length > 0 && red.length > 0;

  /** 可见线条。overlay=true 时只画高亮层（不接收鼠标事件） */
  const renderLine = (e: Edge, overlay: boolean) => {
    const st = edgeStyle(e.relation.weight);
    const hot = hotEdges?.has(e.key) ?? false;
    const sel = e.key === selKey;
    const dimmed = hotEdges != null && !hot;
    return (
      <g key={e.key} style={{ pointerEvents: 'none' }}>
        {overlay && sel && <path d={e.d} fill="none" className={STROKE[e.tone]} strokeWidth={st.width + 8} strokeOpacity={0.25} strokeLinecap="round" />}
        <path
          d={e.d}
          fill="none"
          className={STROKE[e.tone]}
          strokeWidth={overlay ? st.width + 1.2 : st.width}
          strokeOpacity={overlay ? 1 : dimmed ? st.opacity * 0.22 : st.opacity}
          strokeLinecap="round"
          markerEnd={e.arrow ? `url(#${uid}-arrow-${e.tone})` : undefined}
          style={{ transition: 'stroke-opacity 120ms' }}
        />
      </g>
    );
  };

  /** 点击热区：透明粗线。DOM 顺序固定，悬停时不会重新挂载（否则点击可能落空） */
  const renderHit = (e: Edge) => (
    <path
      key={e.key}
      d={e.d}
      fill="none"
      stroke="transparent"
      strokeWidth={16}
      role="button"
      tabIndex={0}
      aria-label={`${e.label}。回车查看依据`}
      aria-pressed={e.key === selKey}
      className="outline-none"
      style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
      onClick={() => onSelect?.(e.relation)}
      onKeyDown={(ev) => handleKey(ev, e.relation)}
      onMouseEnter={() => setHover({ edge: e.key })}
      onMouseLeave={() => setHover(null)}
      onFocus={() => setHover({ edge: e.key })}
      onBlur={() => setHover(null)}
    >
      <title>{`${e.label}\n单击查看依据`}</title>
    </path>
  );

  const renderColumn = (team: HeroData[], side: 'b' | 'r') => {
    const x = side === 'b' ? X_BLUE : X_RED;
    if (!team.length) {
      return (
        <g>
          <rect x={x - 52} y={TOP - AV / 2 - 6} width={104} height={H - TOP + AV / 2 - 6} rx={8} fill="none" className="stroke-line2" strokeDasharray="4 4" />
          <text x={x} y={TOP + 4} textAnchor="middle" fontSize={12} className="fill-mute">
            {side === 'b' ? '蓝方' : '红方'}未选择英雄
          </text>
        </g>
      );
    }
    return team.map((h, i) => {
      const k = `${side}-${h.id}`;
      const hot = hotNodes?.has(k) ?? false;
      const isSelEnd = selected != null && (selected.a === h.id || selected.b === h.id);
      return (
        <g key={k} onMouseEnter={() => setHover({ node: k })} onMouseLeave={() => setHover(null)}>
          <title>{h.name}</title>
          <SvgHeroNode
            hero={h}
            x={x}
            y={yAt(i, team.length, rows)}
            size={AV}
            fontSize={FONT}
            labelWidth={LABEL_W}
            ring={hot || isSelEnd ? (side === 'b' ? 'var(--color-blue)' : 'var(--color-red)') : null}
            dim={hotNodes != null && !hot}
          />
        </g>
      );
    });
  };

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} className="block select-none" role="group" aria-label="阵容对阵关系图">
        <defs>
          {(['blue', 'red'] as const).map((t) => (
            <marker key={t} id={`${uid}-arrow-${t}`} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={10} markerHeight={10} markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0 1 L10 5 L0 9 z" className={FILL[t]} />
            </marker>
          ))}
        </defs>
        <text x={X_BLUE} y={20} textAnchor="middle" fontSize={13} fontWeight={600} className="fill-blue">
          蓝方
        </text>
        <text x={X_RED} y={20} textAnchor="middle" fontSize={13} fontWeight={600} className="fill-red">
          红方
        </text>

        {noEdges && (
          <g>
            <text x={W / 2} y={TOP + ((rows - 1) * ROW_H) / 2} textAnchor="middle" fontSize={13} className="fill-sub">
              暂无结论
            </text>
            <text x={W / 2} y={TOP + ((rows - 1) * ROW_H) / 2 + 17} textAnchor="middle" fontSize={11} className="fill-dim">
              {both ? (scene ? '当前场景下没有已核实的关系' : '没有已核实的关系') : '只有一方时只显示队内配合'}
            </text>
          </g>
        )}

        {/* 普通线条 → 高亮层（悬停/选中）→ 点击热区 */}
        <g>{edges.map((e) => renderLine(e, false))}</g>
        <g>{edges.filter((e) => hotEdges?.has(e.key) || e.key === selKey).map((e) => renderLine(e, true))}</g>
        <g>{edges.map(renderHit)}</g>

        {renderColumn(blue, 'b')}
        {renderColumn(red, 'r')}
      </svg>
      <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11.5px] text-mute">
        <LegendLine tone="blue" arrow text="蓝方克制" />
        <LegendLine tone="red" arrow text="红方克制" />
        <LegendLine tone="good" text="队内配合" />
        <span>线越粗越实，计分权重越高</span>
      </div>
    </div>
  );
}

function LegendLine({ tone, text, arrow }: { tone: Tone; text: string; arrow?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden>
        {arrow ? (
          <>
            <line x1="1" y1="4" x2="15" y2="4" className={STROKE[tone]} strokeWidth="2" />
            <path d="M14 0.5 L21 4 L14 7.5 z" className={FILL[tone]} />
          </>
        ) : (
          <path d="M2 7 Q11 -2 20 7" fill="none" className={STROKE[tone]} strokeWidth="2" />
        )}
      </svg>
      {text}
    </span>
  );
}
