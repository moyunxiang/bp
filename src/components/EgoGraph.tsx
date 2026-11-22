// 单英雄关系图：中心是当前英雄，周围三个扇区——被克制（左上）、克制（右上）、配合（下方）。
// 每个扇区按 weight 降序取前 perSector 个；线的粗细与不透明度反映 weight，箭头表示克制方向。
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import type { Evidence, Relation } from '../engine/relations.ts';
import { useEngine } from '../lib/data.ts';
import type { Scene } from '../types.ts';
import { egoSectors, SECTOR_COLOR, SECTOR_LABEL, type EgoItem } from './graph/egoData.ts';
import { layoutEgo, SECTOR_IDS, wedgePath, type EgoDims, type SectorId } from './graph/egoLayout.ts';
import { edgeStyle, fmtWeight, kindNames, relKey, safeId, textWidth } from './graph/shared.ts';
import { SvgHeroNode } from './graph/SvgHeroNode.tsx';
import { Empty } from './ui.tsx';

export interface EgoGraphProps {
  heroId: number;
  /** 每个扇区最多显示的关系数 */
  perSector: number;
  /** 只显示含有这些类型已核实证据的关系；为空显示全部 */
  kinds?: Evidence['kind'][] | null;
  /** 只显示 scenes 包含该场景或“全局”的关系；为空显示全部 */
  scene?: Scene | null;
  selected?: Relation | null;
  onSelect?: (relation: Relation) => void;
  /** 双击节点：以该英雄为中心 */
  onCenter?: (heroId: number) => void;
  /** 嵌入其他页面的小尺寸展示 */
  compact?: boolean;
  /** 页面内使用：图的高度不超过这个 CSS 长度（例如 'calc(100vh - 200px)'），但不会缩到原尺寸的70%以下 */
  fitHeight?: string;
  className?: string;
}

const FULL: EgoDims = { avatar: 40, font: 12, labelWidth: 66, centerAvatar: 56, centerFont: 14, centerLabelWidth: 100, titleFont: 14 };
const COMPACT: EgoDims = { avatar: 32, font: 11, labelWidth: 58, centerAvatar: 44, centerFont: 12.5, centerLabelWidth: 84, titleFont: 12.5 };
const COLOR_VAR: Record<'bad' | 'warn' | 'good', string> = { bad: 'var(--color-bad)', warn: 'var(--color-warn)', good: 'var(--color-good)' };
const FILL: Record<'bad' | 'warn' | 'good', string> = { bad: 'fill-bad', warn: 'fill-warn', good: 'fill-good' };
const STROKE: Record<'bad' | 'warn' | 'good', string> = { bad: 'stroke-bad', warn: 'stroke-warn', good: 'stroke-good' };

export function EgoGraph({ heroId, perSector, kinds, scene, selected, onSelect, onCenter, compact = false, fitHeight, className = '' }: EgoGraphProps) {
  const engine = useEngine();
  const hero = engine.byId.get(heroId);
  const uid = safeId(useId());
  // 悬停状态记下当时的中心英雄：切换中心后旧的悬停不再生效（同一条关系可能出现在新图里）
  const [hoverState, setHoverState] = useState<{ center: number; key: string } | null>(null);
  const hover = hoverState?.center === heroId ? hoverState.key : null;
  const setHover = (key: string | null) => setHoverState(key == null ? null : { center: heroId, key });
  const d = compact ? COMPACT : FULL;

  const kindsKey = kinds?.join(',') ?? '';
  const sectors = useMemo(
    () => (hero ? egoSectors(engine, heroId, kindsKey ? (kindsKey.split(',') as Evidence['kind'][]) : null, scene) : null),
    [engine, hero, heroId, kindsKey, scene],
  );
  const n = Math.max(1, perSector);
  const shown = useMemo(() => {
    const out = {} as Record<SectorId, EgoItem[]>;
    for (const s of SECTOR_IDS) out[s] = sectors ? sectors[s].items.slice(0, n) : [];
    return out;
  }, [sectors, n]);

  const widthsKey = SECTOR_IDS.map((s) => shown[s].map((it) => Math.round(Math.min(d.labelWidth, textWidth(it.other.name, d.font)))).join(',')).join('|');
  const layout = useMemo(() => {
    const [a, b, c] = widthsKey.split('|').map((x) => (x ? x.split(',').map(Number) : []));
    return layoutEgo({ [SECTOR_IDS[0]]: a, [SECTOR_IDS[1]]: b, [SECTOR_IDS[2]]: c } as Record<SectorId, number[]>, d);
  }, [widthsKey, d]);

  if (!hero || !sectors) return <Empty className={className}>没有找到这个英雄（ID：{heroId}），暂无结论。</Empty>;

  const vb = layout.viewBox;
  const vbW = vb.x1 - vb.x0;
  const vbH = vb.y1 - vb.y0;
  const selKey = selected ? relKey(selected) : null;
  const focusKey = hover;

  const svgStyle = fitHeight
    ? { width: '100%', height: `clamp(${Math.round(vbH * 0.7)}px, ${fitHeight}, ${Math.round(vbH)}px)` }
    : { width: '100%', height: 'auto', maxWidth: compact ? undefined : vbW };

  // 每条边的几何：中心到节点的直线，箭头画在中点（被克制扇区方向相反）
  const edges = SECTOR_IDS.flatMap((s) =>
    shown[s].map((it, i) => {
      const p = layout.nodes[s][i];
      const len = Math.hypot(p.x, p.y) || 1;
      const ux = p.x / len;
      const uy = p.y / len;
      const r0 = d.centerAvatar / 2 + 6;
      const r1 = len - d.avatar / 2 - 6;
      let [sx, sy, ex, ey] = [ux * r0, uy * r0, ux * r1, uy * r1];
      if (s === 'counteredBy') [sx, sy, ex, ey] = [ex, ey, sx, sy];
      const f = (v: number) => v.toFixed(1);
      const key = relKey(it.relation);
      return {
        id: `${s}-${key}`,
        key,
        relation: it.relation,
        color: SECTOR_COLOR[s],
        arrow: s !== 'synergy',
        st: edgeStyle(it.relation.weight),
        d: `M${f(sx)} ${f(sy)} L${f((sx + ex) / 2)} ${f((sy + ey) / 2)} L${f(ex)} ${f(ey)}`,
        line: `M${f(sx)} ${f(sy)} L${f(ex)} ${f(ey)}`,
      };
    }),
  );

  const handleKey = (e: KeyboardEvent, it: EgoItem) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (e.shiftKey) onCenter?.(it.other.id);
      else onSelect?.(it.relation);
    }
  };

  return (
    <div className={className}>
      <svg
        viewBox={`${vb.x0.toFixed(1)} ${vb.y0.toFixed(1)} ${vbW.toFixed(1)} ${vbH.toFixed(1)}`}
        style={svgStyle}
        className="mx-auto block select-none"
        role="group"
        aria-label={`${hero.name}的关系图`}
      >
        <defs>
          {(['bad', 'warn'] as const).map((c) => (
            <marker key={c} id={`${uid}-arrow-${c}`} viewBox="0 0 10 10" refX={5} refY={5} markerWidth={compact ? 8 : 10} markerHeight={compact ? 8 : 10} markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0 1 L10 5 L0 9 z" className={FILL[c]} />
            </marker>
          ))}
        </defs>

        {/* 扇区背景与标题 */}
        {SECTOR_IDS.map((s) => {
          const g = layout.sectors[s];
          const c = SECTOR_COLOR[s];
          const sec = sectors[s];
          const cnt = shown[s].length;
          const sub = cnt ? (sec.items.length > cnt ? `前${cnt}条 / 筛选后${sec.items.length}条` : `${cnt}条`) : sec.total ? '当前筛选下无' : '暂无结论';
          return (
            <g key={s}>
              <path d={wedgePath(g.mid, g.wedgeR)} className={FILL[c]} fillOpacity={0.045} />
              <text x={g.title.x} y={g.title.y} textAnchor="middle" fontSize={d.titleFont} fontWeight={600} className={FILL[c]}>
                {SECTOR_LABEL[s]}
              </text>
              <text x={g.title.x} y={g.title.y + d.titleFont + 3} textAnchor="middle" fontSize={d.titleFont - 3} className="fill-mute">
                {sub}
              </text>
              {cnt === 0 && (
                <g>
                  <text x={g.empty.x} y={g.empty.y} textAnchor="middle" fontSize={d.font + 1} className="fill-sub">
                    暂无结论
                  </text>
                  <text x={g.empty.x} y={g.empty.y + d.font + 5} textAnchor="middle" fontSize={d.font - 1.5} className="fill-dim">
                    {sec.total ? `另有${sec.total}条不符合筛选` : '没有已核实的关系'}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* 连线：普通线条 → 高亮层（悬停/选中，不接收鼠标事件）→ 点击热区。热区 DOM 顺序固定，悬停时不会重新挂载 */}
        <g style={{ pointerEvents: 'none' }}>
          {edges.map((e) => {
            const dimmed = focusKey != null && e.key !== focusKey && e.key !== selKey;
            return (
              <path
                key={e.id}
                d={e.d}
                className={STROKE[e.color]}
                fill="none"
                strokeWidth={e.st.width}
                strokeOpacity={dimmed ? e.st.opacity * 0.3 : e.st.opacity}
                strokeLinecap="round"
                markerMid={e.arrow ? `url(#${uid}-arrow-${e.color})` : undefined}
                style={{ transition: 'stroke-opacity 120ms' }}
              />
            );
          })}
        </g>
        <g style={{ pointerEvents: 'none' }}>
          {edges
            .filter((e) => e.key === selKey || e.key === focusKey)
            .map((e) => (
              <g key={e.id}>
                {e.key === selKey && <path d={e.line} className={STROKE[e.color]} strokeWidth={e.st.width + 7} strokeOpacity={0.22} strokeLinecap="round" fill="none" />}
                <path d={e.d} className={STROKE[e.color]} fill="none" strokeWidth={e.st.width + 1.2} strokeLinecap="round" markerMid={e.arrow ? `url(#${uid}-arrow-${e.color})` : undefined} />
              </g>
            ))}
        </g>
        <g>
          {edges.map((e) => (
            <path
              key={e.id}
              d={e.line}
              stroke="transparent"
              strokeWidth={14}
              fill="none"
              style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
              onClick={() => onSelect?.(e.relation)}
              onMouseEnter={() => setHover(e.key)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </g>

        {/* 中心英雄 */}
        <SvgHeroNode hero={hero} x={0} y={0} size={d.centerAvatar} fontSize={d.centerFont} labelWidth={d.centerLabelWidth} ring="var(--color-sub)" bold />

        {/* 周围节点 */}
        {SECTOR_IDS.flatMap((s) =>
          shown[s].map((it, i) => {
            const k = relKey(it.relation);
            const p = layout.nodes[s][i];
            const isSel = k === selKey;
            const isHover = k === focusKey;
            const dimmed = focusKey != null && !isHover && !isSel;
            const hw = Math.max(d.avatar, d.labelWidth) / 2;
            const label = `${it.other.name}：${s === 'counters' ? `${hero.name}克制${it.other.name}` : s === 'counteredBy' ? `${it.other.name}克制${hero.name}` : `与${hero.name}配合`}，权重${fmtWeight(it.relation.weight)}，证据：${kindNames(it.relation)}`;
            return (
              <g
                key={`${s}-${k}`}
                role="button"
                tabIndex={0}
                aria-label={`${label}。回车查看依据，Shift加回车以它为中心`}
                aria-pressed={isSel}
                className="outline-none"
                style={{ cursor: 'pointer' }}
                onClick={() => onSelect?.(it.relation)}
                onDoubleClick={() => onCenter?.(it.other.id)}
                onKeyDown={(e) => handleKey(e, it)}
                onMouseEnter={() => setHover(k)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(k)}
                onBlur={() => setHover(null)}
              >
                <title>{`${label}\n单击查看依据，双击以它为中心`}</title>
                <rect x={p.x - hw - 4} y={p.y - d.avatar / 2 - 4} width={hw * 2 + 8} height={d.avatar + d.font + 12} rx={6} fill="transparent" />
                <SvgHeroNode
                  hero={it.other}
                  x={p.x}
                  y={p.y}
                  size={d.avatar}
                  fontSize={d.font}
                  labelWidth={d.labelWidth}
                  ring={isSel ? COLOR_VAR[SECTOR_COLOR[s]] : isHover ? 'var(--color-line2)' : null}
                  dim={dimmed}
                  labelClass={isSel ? 'fill-ink' : 'fill-sub'}
                />
              </g>
            );
          }),
        )}
      </svg>
      <div className={`mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-mute ${compact ? 'text-[11px]' : 'text-[12px]'}`}>
        <Legend color="bad" arrow text={`${hero.name}克制它`} />
        <Legend color="warn" arrow text={`它克制${hero.name}`} />
        <Legend color="good" text="配合（无方向）" />
        <span>线越粗越实，计分权重越高（不是胜率）</span>
        {!compact && <span className="text-dim">单击头像查看依据 · 双击以它为中心</span>}
      </div>
    </div>
  );
}

function Legend({ color, text, arrow }: { color: 'bad' | 'warn' | 'good'; text: string; arrow?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden>
        <line x1="1" y1="4" x2={arrow ? 15 : 21} y2="4" className={STROKE[color]} strokeWidth="2" />
        {arrow && <path d="M14 0.5 L21 4 L14 7.5 z" className={FILL[color]} />}
      </svg>
      {text}
    </span>
  );
}
