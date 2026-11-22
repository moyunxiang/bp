// 通用小组件。
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { HERO_TYPE_NAME, LANE_SHORT, type HeroData, type Lane, type VerifyStatus } from '../types.ts';
import type { Confidence } from '../engine/recommend.ts';

const TYPE_COLOR: Record<number, string> = { 1: '#d9884a', 2: '#7a8cff', 3: '#5aa6a0', 4: '#c0627f', 5: '#d7b24c', 6: '#59b377' };

/** 头像：热链官方图片；加载失败时退回文字色块。尺寸不一的原图统一裁成方形。 */
export function HeroAvatar({ hero, size = 40, className = '', dim = false, ring }: { hero: HeroData; size?: number; className?: string; dim?: boolean; ring?: string }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, borderRadius: Math.max(4, Math.round(size * 0.18)), boxShadow: ring ? `0 0 0 2px ${ring}` : undefined };
  if (failed) {
    return (
      <span
        className={`inline-flex shrink-0 select-none items-center justify-center font-semibold text-white ${dim ? 'opacity-35 grayscale' : ''} ${className}`}
        style={{ ...style, background: TYPE_COLOR[hero.heroType] ?? '#445', fontSize: Math.max(10, Math.round(size * 0.36)) }}
        title={hero.name}
      >
        {hero.name.replace(/[（(].*$/, '').slice(0, size >= 36 ? 2 : 1)}
      </span>
    );
  }
  return (
    <img
      src={hero.avatar}
      alt={hero.name}
      title={hero.name}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(true)}
      className={`shrink-0 select-none bg-panel3 object-cover ${dim ? 'opacity-35 grayscale' : ''} ${className}`}
      style={style}
    />
  );
}

export function HeroLink({ hero, size = 22, className = '' }: { hero: HeroData; size?: number; className?: string }) {
  return (
    <Link to={`/heroes/${hero.id}`} className={`inline-flex items-center gap-1.5 align-middle hover:text-blue ${className}`}>
      <HeroAvatar hero={hero} size={size} />
      <span>{hero.name}</span>
    </Link>
  );
}

const LANE_COLOR: Record<Lane, string> = { 1: '#d9884a', 2: '#c0627f', 3: '#7a8cff', 4: '#d7b24c', 5: '#59b377' };

export function LaneBadge({ lane, muted = false, className = '' }: { lane: Lane; muted?: boolean; className?: string }) {
  return (
    <span
      className={`inline-flex h-[18px] items-center rounded px-1.5 text-[11px] font-medium ${className}`}
      style={{ color: muted ? 'var(--color-mute)' : LANE_COLOR[lane], background: muted ? 'var(--color-panel3)' : `${LANE_COLOR[lane]}22` }}
    >
      {LANE_SHORT[lane]}
    </span>
  );
}

export function TypeBadge({ type }: { type: number }) {
  return (
    <span className="inline-flex h-[18px] items-center rounded px-1.5 text-[11px]" style={{ color: TYPE_COLOR[type], background: `${TYPE_COLOR[type]}22` }}>
      {HERO_TYPE_NAME[type]}
    </span>
  );
}

const CONF_STYLE: Record<Confidence, string> = { 高: 'text-good bg-good/15', 中: 'text-warn bg-warn/15', 低: 'text-mute bg-panel3' };

export function ConfidenceBadge({ level, title }: { level: Confidence; title?: string }) {
  return (
    <span className={`inline-flex h-[18px] items-center rounded px-1.5 text-[11px] ${CONF_STYLE[level]}`} title={title}>
      可信{level}
    </span>
  );
}

export function StatusBadge({ status }: { status: VerifyStatus | 'needs_review' | 'stale' }) {
  const map = {
    verified: ['已核实', 'text-good bg-good/15'],
    disputed: ['存疑', 'text-warn bg-warn/15'],
    unverified: ['未核实', 'text-mute bg-panel3'],
    needs_review: ['待复核', 'text-warn bg-warn/15'],
    stale: ['可能过期', 'text-warn bg-warn/15'],
  } as const;
  const [label, cls] = map[status];
  return <span className={`inline-flex h-[18px] items-center rounded px-1.5 text-[11px] ${cls}`}>{label}</span>;
}

export function Segmented<T extends string | number>({ value, options, onChange, className = '' }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={`seg ${className}`} role="group">
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-mute ${className}`}>{children}</div>;
}

export function Section({ title, extra, children, className = '' }: { title: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="panel-title">{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

/** 带正负号的分数变化 */
export function Delta({ value }: { value: number }) {
  if (!value) return <span className="text-dim">0</span>;
  return <span className={value > 0 ? 'text-good' : 'text-bad'}>{value > 0 ? `+${value}` : value}</span>;
}

export function Star({ on, onClick, title }: { on: boolean; onClick: () => void; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title ?? (on ? '取消收藏' : '收藏')} className={`btn btn-ghost btn-sm !px-1.5 ${on ? '!text-gold' : ''}`} aria-pressed={on}>
      {on ? '★' : '☆'}
    </button>
  );
}
