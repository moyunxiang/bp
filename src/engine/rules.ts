// 规则条件求值。只使用已核实（verified）的标签；“没有某机制”要求档案里连存疑标签都没有。
import type { Cond, HeroData, ProfileTag } from '../types.ts';

export interface CondResult {
  ok: boolean;
  /** 支撑该条件的标签（带原文引用），用于展示依据 */
  tags: ProfileTag[];
  /** 非标签类依据的文字说明（官方职业、没有某类技能） */
  notes: string[];
}

const FAIL: CondResult = { ok: false, tags: [], notes: [] };

/** 档案可用于计分：已盲审且官方原文未变化 */
export const profileUsable = (h: HeroData) => h.profile?.status === 'verified';

export function verifiedTags(h: HeroData, ids?: string[]): ProfileTag[] {
  if (!profileUsable(h)) return [];
  return h.profile!.tags.filter((t) => t.status === 'verified' && (!ids || ids.includes(t.tag)));
}

/** 拥有其中任一标签的不同技能数 */
export function tagSkillCount(h: HeroData, ids: string[]): number {
  return new Set(verifiedTags(h, ids).map((t) => t.slot)).size;
}

export const hasTag = (h: HeroData, id: string) => tagSkillCount(h, [id]) > 0;

export function evalCond(h: HeroData, cond: Cond, typeName: (t: number) => string, tagName: (id: string) => string): CondResult {
  const out: CondResult = { ok: true, tags: [], notes: [] };
  if (cond.all) {
    for (const c of cond.all) {
      const r = evalCond(h, c, typeName, tagName);
      if (!r.ok) return FAIL;
      out.tags.push(...r.tags);
      out.notes.push(...r.notes);
    }
  }
  if (cond.heroType) {
    if (!cond.heroType.includes(h.heroType)) return FAIL;
    out.notes.push(`官方职业：${typeName(h.heroType)}`);
  }
  if (cond.tags) {
    const tags = verifiedTags(h, cond.tags);
    if (new Set(tags.map((t) => t.slot)).size < (cond.min ?? 1)) return FAIL;
    out.tags.push(...tags);
  }
  if (cond.none) {
    // 否定判断必须建立在完整且已核实的档案上；存疑标签也算“可能有”
    if (!profileUsable(h)) return FAIL;
    if (h.profile!.tags.some((t) => cond.none!.includes(t.tag))) return FAIL;
    out.notes.push(`技能原文中没有：${cond.none.map(tagName).join('、')}`);
  }
  return out;
}
