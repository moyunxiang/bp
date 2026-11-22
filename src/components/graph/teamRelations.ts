// 阵容对阵的关系汇总：跨队克制（两个方向分别统计）、队内配合、没有已核实关系的对位。
import type { Relation, RelationIndex } from '../../engine/relations.ts';
import type { HeroData, Scene } from '../../types.ts';
import { isVerified, sceneOk } from './shared.ts';

export interface TeamRelations {
  /** 蓝方英雄克制红方英雄（a 在蓝方） */
  blueCounters: Relation[];
  /** 红方英雄克制蓝方英雄（a 在红方） */
  redCounters: Relation[];
  blueSynergy: Relation[];
  redSynergy: Relation[];
  /** 双方都没有已核实克制关系的对位（显示为暂无结论） */
  noConclusion: [HeroData, HeroData][];
  /** 有已核实克制关系、但都不适用于当前场景的对位数 */
  sceneHidden: number;
  /** 队内没有已核实配合的英雄对数 */
  noSynergyPairs: number;
}

const byWeight = (x: Relation, y: Relation) => y.weight - x.weight;

function synergyOf(rel: RelationIndex, team: HeroData[], scene: Scene | null | undefined, out: Relation[]): number {
  let none = 0;
  for (let i = 0; i < team.length; i++)
    for (let j = i + 1; j < team.length; j++) {
      const r = rel.getSynergy(team[i].id, team[j].id);
      if (!r || !isVerified(r)) none++;
      else if (sceneOk(r, scene)) out.push(r);
    }
  return none;
}

export function teamRelations(rel: RelationIndex, blue: HeroData[], red: HeroData[], scene?: Scene | null): TeamRelations {
  const out: TeamRelations = { blueCounters: [], redCounters: [], blueSynergy: [], redSynergy: [], noConclusion: [], sceneHidden: 0, noSynergyPairs: 0 };
  for (const b of blue)
    for (const r of red) {
      if (b.id === r.id) continue;
      const br = rel.getCounter(b.id, r.id);
      const rb = rel.getCounter(r.id, b.id);
      const vbr = br && isVerified(br) ? br : null;
      const vrb = rb && isVerified(rb) ? rb : null;
      if (!vbr && !vrb) {
        out.noConclusion.push([b, r]);
        continue;
      }
      let shown = false;
      if (vbr && sceneOk(vbr, scene)) {
        out.blueCounters.push(vbr);
        shown = true;
      }
      if (vrb && sceneOk(vrb, scene)) {
        out.redCounters.push(vrb);
        shown = true;
      }
      if (!shown) out.sceneHidden++;
    }
  out.noSynergyPairs = synergyOf(rel, blue, scene, out.blueSynergy) + synergyOf(rel, red, scene, out.redSynergy);
  out.blueCounters.sort(byWeight);
  out.redCounters.sort(byWeight);
  out.blueSynergy.sort(byWeight);
  out.redSynergy.sort(byWeight);
  return out;
}
