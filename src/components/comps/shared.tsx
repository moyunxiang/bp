// 阵容库共用的小工具：解析英雄ID、职业赛阵容索引、英雄列表折叠等。
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Bundle, HeroData } from '../../types.ts';
import { useEngine, useTagMap } from '../../lib/data.ts';
import { compKey } from '../../lib/userStore.ts';
import { matchArchetypes, type ArchetypeMatch } from '../../engine/comp.ts';
import { HeroAvatar } from '../ui.tsx';

export type TabKey = 'archetypes' | 'pro' | 'mine' | 'compare';

/** URL 参数修改：值为 null 表示删除该参数 */
export type ParamPatch = Record<string, string | null>;

/** 从 URL 参数等字符串中解析英雄ID：支持逗号、短横线、空白分隔，去重并保持顺序 */
export function parseIds(s: string | null | undefined): number[] {
  if (!s) return [];
  const out: number[] = [];
  for (const part of s.split(/[\s,，\-]+/)) {
    if (!/^\d+$/.test(part)) continue;
    const n = Number(part);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** 把ID解析成英雄，返回不存在的ID以便提示 */
export function resolveHeroes(byId: Map<number, HeroData>, ids: number[]): { heroes: HeroData[]; missing: number[] } {
  const heroes: HeroData[] = [];
  const missing: number[] = [];
  for (const id of ids) {
    const h = byId.get(id);
    if (h) heroes.push(h);
    else missing.push(id);
  }
  return { heroes, missing };
}

export function useTagName(): (id: string) => string {
  const tagMap = useTagMap();
  return (id: string) => tagMap.get(id)?.name ?? id;
}

export const graphLink = (blue: number[], red?: number[]) => `/graph?mode=team&blue=${blue.join(',')}${red && red.length ? `&red=${red.join(',')}` : ''}`;

export const newCompId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const sameGroup = (a: HeroData, b: HeroData) => a.groupId != null && a.groupId === b.groupId;

// ---------- 职业赛阵容索引 ----------

export interface ProComp {
  key: string;
  kind: 'lineup' | 'trio';
  ids: number[];
  heroes: HeroData[];
  missing: number[];
  n: number;
  first: string;
  last: string;
  matches: ArchetypeMatch[];
}

const proCache = new WeakMap<Bundle, ProComp[]>();

/** 职业赛自动发现的阵容（完整阵容与三人组合），按出现次数降序；数据包没有时返回 null */
export function useProComps(): ProComp[] | null {
  const engine = useEngine();
  const tagName = useTagName();
  const { bundle, byId } = engine;
  return useMemo(() => {
    if (!bundle.comps) return null;
    const hit = proCache.get(bundle);
    if (hit) return hit;
    const build = (kind: ProComp['kind'], list: { heroes: number[]; n: number; first: string; last: string }[]): ProComp[] =>
      list.map((c) => {
        const { heroes, missing } = resolveHeroes(byId, c.heroes);
        return { key: compKey(c.heroes), kind, ids: c.heroes, heroes, missing, n: c.n, first: c.first, last: c.last, matches: matchArchetypes(heroes, bundle.archetypes, tagName) };
      });
    const all = [...build('lineup', bundle.comps.lineups ?? []), ...build('trio', bundle.comps.trios ?? [])].sort((a, b) => b.n - a.n);
    proCache.set(bundle, all);
    return all;
    // tagName 由 bundle 的标签表决定，按 bundle 缓存即可
  }, [bundle, byId]);
}

export function useProIndex(): Map<string, ProComp> {
  const pro = useProComps();
  return useMemo(() => new Map((pro ?? []).map((c) => [c.key, c])), [pro]);
}

// ---------- 展示 ----------

export function LimitedChip() {
  return <span className="inline-flex h-[16px] items-center rounded bg-warn/15 px-1 text-[10.5px] text-warn">限时</span>;
}

/** 头像加名字的英雄链接列表，数量多时折叠 */
export function HeroChips({ heroes, limit = 12, size = 20, empty }: { heroes: HeroData[]; limit?: number; size?: number; empty?: ReactNode }) {
  const [all, setAll] = useState(false);
  if (!heroes.length) return <span className="text-[12px] text-mute">{empty ?? '没有符合条件的英雄'}</span>;
  const shown = all ? heroes : heroes.slice(0, limit);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((h) => (
        <Link key={h.id} to={`/heroes/${h.id}`} className="inline-flex items-center gap-1 rounded-md bg-panel2 py-0.5 pl-0.5 pr-1.5 text-[12px] text-sub hover:bg-panel3 hover:text-ink">
          <HeroAvatar hero={h} size={size} />
          {h.name}
          {h.isLimited && <LimitedChip />}
        </Link>
      ))}
      {heroes.length > limit && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll(!all)}>
          {all ? '收起' : `显示全部${heroes.length}个`}
        </button>
      )}
    </div>
  );
}

/** 只有头像的英雄排，可选在头像下方显示附加内容（如分路） */
export function AvatarRow({ heroes, size = 36, below, ring }: { heroes: HeroData[]; size?: number; below?: (h: HeroData, i: number) => ReactNode; ring?: (h: HeroData) => string | undefined }) {
  return (
    <div className="flex items-start gap-1.5">
      {heroes.map((h, i) => (
        <div key={h.id} className="flex flex-col items-center gap-0.5" style={{ width: size + 6 }}>
          <HeroAvatar hero={h} size={size} ring={ring?.(h)} />
          {below ? below(h, i) : <span className="w-full truncate text-center text-[11px] text-sub">{h.name}</span>}
        </div>
      ))}
    </div>
  );
}

export function Toggle({ open, onClick, children }: { open: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open} onClick={onClick}>
      <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      {children}
    </button>
  );
}

export function Note({ children, tone = 'mute', className = '' }: { children: ReactNode; tone?: 'mute' | 'warn' | 'bad'; className?: string }) {
  const cls = tone === 'warn' ? 'border-warn/30 bg-warn/10 text-warn' : tone === 'bad' ? 'border-bad/30 bg-bad/10 text-bad' : 'border-line bg-panel2/60 text-mute';
  return <div className={`rounded-md border px-3 py-2 text-[12px] leading-relaxed ${cls} ${className}`}>{children}</div>;
}
