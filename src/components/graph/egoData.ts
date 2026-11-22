// 单英雄图谱的数据：把某英雄的关系分成三个扇区，按筛选条件过滤并按 weight 降序排列。
import type { Engine } from '../../engine/recommend.ts';
import type { Evidence, Relation } from '../../engine/relations.ts';
import type { HeroData, Scene } from '../../types.ts';
import { isVerified, kindOk, sceneOk } from './shared.ts';
import type { SectorId } from './egoLayout.ts';

export interface EgoItem {
  relation: Relation;
  /** 扇区中的另一方英雄 */
  other: HeroData;
}

export interface EgoSector {
  id: SectorId;
  /** 通过筛选的全部关系（weight 降序） */
  items: EgoItem[];
  /** 该英雄在这个扇区的已核实关系总数（不看筛选） */
  total: number;
}

export const SECTOR_LABEL: Record<SectorId, string> = { counters: '克制', counteredBy: '被克制', synergy: '配合' };
/** 扇区说明，{name} 替换为中心英雄名 */
export const SECTOR_HINT: Record<SectorId, string> = {
  counters: '{name}克制的英雄',
  counteredBy: '克制{name}的英雄',
  synergy: '与{name}配合的英雄',
};
/** 扇区颜色：克制=bad，被克制=warn，配合=good（Tailwind 类名后缀） */
export const SECTOR_COLOR: Record<SectorId, 'bad' | 'warn' | 'good'> = { counters: 'bad', counteredBy: 'warn', synergy: 'good' };

export function egoSectors(engine: Engine, heroId: number, kinds?: Evidence['kind'][] | null, scene?: Scene | null): Record<SectorId, EgoSector> {
  const { rel, byId } = engine;
  const build = (id: SectorId, list: Relation[], otherOf: (r: Relation) => number): EgoSector => {
    const verified = list.filter(isVerified);
    const items: EgoItem[] = [];
    for (const r of verified) {
      if (!sceneOk(r, scene) || !kindOk(r, kinds)) continue;
      const other = byId.get(otherOf(r));
      if (other) items.push({ relation: r, other });
    }
    items.sort((x, y) => y.relation.weight - x.relation.weight || x.other.pinyin.localeCompare(y.other.pinyin));
    return { id, items, total: verified.length };
  };
  return {
    counters: build('counters', rel.counters(heroId), (r) => r.b),
    counteredBy: build('counteredBy', rel.counteredBy(heroId), (r) => r.a),
    synergy: build('synergy', rel.synergies(heroId), (r) => (r.a === heroId ? r.b : r.a)),
  };
}

/** 只有存疑证据（weight 为 0）的关系数量：图上不画，界面上注明 */
export function doubtfulOnlyCount(engine: Engine, heroId: number): number {
  const { rel } = engine;
  return [...rel.counters(heroId), ...rel.counteredBy(heroId), ...rel.synergies(heroId)].filter((r) => !isVerified(r)).length;
}
