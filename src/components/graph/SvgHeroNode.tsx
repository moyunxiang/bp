// SVG 中的英雄节点：头像（HeroAvatar，经 foreignObject 嵌入，保留加载失败回退）+ 名字。
// 坐标 (x, y) 是头像中心；名字在头像下方，过长时压缩字距到 labelWidth 以内。
import type { ReactNode } from 'react';
import type { HeroData } from '../../types.ts';
import { HeroAvatar } from '../ui.tsx';
import { textWidth } from './shared.ts';

export interface SvgHeroNodeProps {
  hero: HeroData;
  x: number;
  y: number;
  size: number;
  fontSize: number;
  labelWidth: number;
  /** 头像外框颜色（CSS 颜色值），用于选中/悬停/中心节点 */
  ring?: string | null;
  dim?: boolean;
  /** 名字的文字颜色类 */
  labelClass?: string;
  bold?: boolean;
  children?: ReactNode;
}

export function SvgHeroNode({ hero, x, y, size, fontSize, labelWidth, ring, dim, labelClass = 'fill-ink', bold, children }: SvgHeroNodeProps) {
  const half = size / 2;
  const radius = Math.max(4, Math.round(size * 0.18));
  const w = textWidth(hero.name, fontSize);
  return (
    <g transform={`translate(${x},${y})`} style={{ opacity: dim ? 0.28 : 1, transition: 'opacity 120ms' }}>
      {ring && <rect x={-half - 3} y={-half - 3} width={size + 6} height={size + 6} rx={radius + 3} fill="none" stroke={ring} strokeWidth={2} />}
      <rect x={-half} y={-half} width={size} height={size} rx={radius} className="fill-panel3" />
      <foreignObject x={-half} y={-half} width={size} height={size} style={{ overflow: 'visible', pointerEvents: 'none' }}>
        <HeroAvatar hero={hero} size={size} />
      </foreignObject>
      <text
        y={half + fontSize + 3}
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight={bold ? 600 : undefined}
        className={labelClass}
        // 名字带底色描边：连线可以从名字下方经过而不影响阅读
        style={{ pointerEvents: 'none', paintOrder: 'stroke', stroke: 'var(--color-panel)', strokeWidth: 3.5, strokeLinejoin: 'round' }}
        {...(w > labelWidth ? { textLength: labelWidth, lengthAdjust: 'spacingAndGlyphs' } : {})}
      >
        {hero.name}
      </text>
      {hero.isLimited && (
        <g transform={`translate(${half - 2},${-half + 2})`} style={{ pointerEvents: 'none' }}>
          <rect x={-13} y={-6} width={26} height={12} rx={3} className="fill-warn" />
          <text y={3.5} textAnchor="middle" fontSize={8.5} className="fill-bg" fontWeight={600}>
            限时
          </text>
        </g>
      )}
      {children}
    </g>
  );
}
