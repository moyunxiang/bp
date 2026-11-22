// 英雄搜索：支持中文名、称号、全拼、首字母、外号。
import type { HeroData } from '../types.ts';

/** 匹配得分，越小越靠前；不匹配返回 null */
export function matchHero(h: HeroData, raw: string): number | null {
  const q = raw.trim().toLowerCase();
  if (!q) return 100;
  if (h.name === q) return 0;
  if (h.aliases.includes(q)) return 1;
  if (h.initials === q) return 2;
  if (h.pinyin === q) return 2;
  if (h.name.startsWith(q)) return 3;
  if (h.aliases.some((a) => a.startsWith(q))) return 4;
  if (h.initials.startsWith(q)) return 5;
  if (h.pinyin.startsWith(q)) return 6;
  if (h.name.includes(q)) return 7;
  if (h.aliases.some((a) => a.includes(q))) return 8;
  if (q.length >= 2 && h.pinyin.includes(q)) return 9;
  if (h.title.includes(q)) return 10;
  return null;
}

export function searchHeroes(heroes: HeroData[], q: string): HeroData[] {
  if (!q.trim()) return heroes;
  return heroes
    .map((h) => ({ h, s: matchHero(h, q) }))
    .filter((x): x is { h: HeroData; s: number } => x.s != null)
    .sort((a, b) => a.s - b.s || a.h.pinyin.localeCompare(b.h.pinyin))
    .map((x) => x.h);
}
