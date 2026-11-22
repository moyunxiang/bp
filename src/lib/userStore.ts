// 个人数据：英雄池、偏好、收藏、自定义阵容。
// 保存在浏览器 localStorage；仓库里的 user/profile.json 是公开的默认值，可在“我的”页面导出后提交覆盖。
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import defaults from '../../user/profile.json';
import type { Lane } from '../types.ts';
import type { Mode, Side } from '../engine/draft.ts';
import type { PoolEntry } from '../engine/recommend.ts';

export interface CustomComp {
  id: string;
  name: string;
  heroes: number[];
  note: string;
  updatedAt: string;
}

export interface Prefs {
  mySide: Side;
  /** 我在几楼（1–5），不指定为 null */
  myFloor: number | null;
  myLane: Lane | null;
  mode: Mode;
  banPerSide: number;
  usePool: boolean;
  research: boolean;
}

export interface Profile {
  pool: PoolEntry[];
  prefs: Prefs;
  favoriteHeroes: number[];
  /** 收藏的阵容：KPL自动发现的阵容用英雄ID升序拼接作为键 */
  favoriteComps: string[];
  customComps: CustomComp[];
}

interface UserState extends Profile {
  setPool: (id: number, level: number | null) => void;
  setPrefs: (p: Partial<Prefs>) => void;
  toggleFavoriteHero: (id: number) => void;
  toggleFavoriteComp: (key: string) => void;
  saveComp: (c: Omit<CustomComp, 'updatedAt'>) => void;
  deleteComp: (id: string) => void;
  importProfile: (p: Partial<Profile>) => void;
  resetToRepo: () => void;
}

const repoDefaults = (): Profile => ({
  pool: (defaults.pool as PoolEntry[]) ?? [],
  prefs: { myFloor: null, ...(defaults.prefs as Partial<Prefs>) } as Prefs,
  favoriteHeroes: (defaults.favoriteHeroes as number[]) ?? [],
  favoriteComps: (defaults.favoriteComps as string[]) ?? [],
  customComps: (defaults.customComps as CustomComp[]) ?? [],
});

export const compKey = (heroes: number[]) => [...heroes].sort((a, b) => a - b).join('-');
const today = () => new Date().toISOString().slice(0, 10);

export const useUser = create<UserState>()(
  persist(
    (set) => ({
      ...repoDefaults(),
      setPool: (id, level) =>
        set((s) => {
          const rest = s.pool.filter((p) => p.id !== id);
          return { pool: level == null ? rest : [...rest, { id, level }] };
        }),
      setPrefs: (p) => set((s) => ({ prefs: { ...s.prefs, ...p } })),
      toggleFavoriteHero: (id) => set((s) => ({ favoriteHeroes: s.favoriteHeroes.includes(id) ? s.favoriteHeroes.filter((x) => x !== id) : [...s.favoriteHeroes, id] })),
      toggleFavoriteComp: (key) => set((s) => ({ favoriteComps: s.favoriteComps.includes(key) ? s.favoriteComps.filter((x) => x !== key) : [...s.favoriteComps, key] })),
      saveComp: (c) =>
        set((s) => ({
          customComps: [...s.customComps.filter((x) => x.id !== c.id), { ...c, updatedAt: today() }],
        })),
      deleteComp: (id) => set((s) => ({ customComps: s.customComps.filter((x) => x.id !== id) })),
      importProfile: (p) =>
        set((s) => ({
          pool: Array.isArray(p.pool) ? p.pool.filter((x) => typeof x?.id === 'number' && [1, 2, 3].includes(x.level)) : s.pool,
          prefs: { ...s.prefs, ...(p.prefs ?? {}) },
          favoriteHeroes: Array.isArray(p.favoriteHeroes) ? p.favoriteHeroes : s.favoriteHeroes,
          favoriteComps: Array.isArray(p.favoriteComps) ? p.favoriteComps : s.favoriteComps,
          customComps: Array.isArray(p.customComps) ? p.customComps : s.customComps,
        })),
      resetToRepo: () => set(repoDefaults()),
    }),
    { name: 'hok-bp-profile', version: 1 },
  ),
);

/** 导出为可提交到仓库 user/profile.json 的内容 */
export function exportProfile(s: Profile): string {
  return (
    JSON.stringify(
      {
        note: defaults.note,
        updatedAt: today(),
        pool: [...s.pool].sort((a, b) => a.id - b.id),
        prefs: s.prefs,
        favoriteHeroes: s.favoriteHeroes,
        favoriteComps: s.favoriteComps,
        customComps: s.customComps,
      },
      null,
      2,
    ) + '\n'
  );
}
