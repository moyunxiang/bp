// 校验并合并机制档案：data/curated/heroes + data/curated/review → data/derived/profiles.json
// - 每个标签的 quote 必须逐字存在于对应技能原文，否则丢弃。
// - 撰写方与盲审方在 (标签, 技能) 上一致才算 verified；只有一方标注的记为 disputed，不参与计分。
//   disputed 可由 data/curated/adjudication/{id}.json 裁定。
// - 说明文字被盲审判为 unsupported 的条目丢弃。
// - 技能原文 hash 与档案盖章时不一致 → needs_review，整份档案不参与计分。
// 用法：tsx scripts/build-profiles.ts [--stamp]   （--stamp：把当前原文hash记为已撰写版本）
import { resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { z } from 'zod';
import { ROOT, exists, readJson, writeJson } from './lib/http.ts';
import type { HeroProfile, OfficialHero, ProfileTag, ProseItem } from '../src/types.ts';

const CUR = resolve(ROOT, 'data/curated');
const stamp = process.argv.includes('--stamp');

const TagZ = z.object({ tag: z.string(), slot: z.string(), quote: z.string() });
const ProseZ = z.object({ text: z.string().min(1), refs: z.array(z.string()).default([]), quote: z.string().optional() });
const ComboZ = z.object({ order: z.array(z.string()).min(1), why: z.string().min(1), quote: z.string() });
const ProfileZ = z.object({
  id: z.number(),
  name: z.string(),
  tags: z.array(TagZ),
  summary: z.string().default(''),
  strengths: z.array(ProseZ).default([]),
  weaknesses: z.array(ProseZ).default([]),
  combos: z.array(ComboZ).default([]),
  interactions: z.array(ProseZ).default([]),
});
const ReviewZ = z.object({
  id: z.number(),
  tags: z.array(TagZ),
  prose: z
    .array(z.object({ field: z.string(), index: z.number(), verdict: z.enum(['ok', 'unsupported']), reason: z.string().optional() }))
    .default([]),
});
const AdjZ = z.object({
  id: z.number(),
  decisions: z.array(z.object({ tag: z.string(), slot: z.string(), verdict: z.enum(['accept', 'reject']), quote: z.string().optional(), reason: z.string() })),
});

const norm = (s: string) => s.replace(/\s+/g, '');
// 禁止出现在说明文字里的表述（强度评价、无法验证的说法）
const BANNED = /版本强势|T0|T1|T度|职业选手|高端局|胜率|上分/;

async function loadDir<T>(dir: string, schema: z.ZodType<T>, problems: string[]): Promise<Map<number, T>> {
  const out = new Map<number, T>();
  if (!(await exists(dir))) return out;
  for (const f of (await readdir(dir)).filter((x) => x.endsWith('.json'))) {
    try {
      const parsed = schema.parse(await readJson(resolve(dir, f)));
      out.set((parsed as { id: number }).id, parsed);
    } catch (e) {
      problems.push(`${dir.split('/').pop()}/${f}: 格式错误 ${(e as Error).message.slice(0, 200)}`);
    }
  }
  return out;
}

async function main() {
  const { heroes } = await readJson<{ heroes: OfficialHero[] }>(resolve(ROOT, 'data/derived/official/heroes.json'));
  const vocab = new Set((await readJson<{ tags: { id: string }[] }>(resolve(CUR, 'tags.json'))).tags.map((t) => t.id));
  const stampsPath = resolve(CUR, 'stamps.json');
  const stamps: Record<string, string> = (await exists(stampsPath)) ? await readJson(stampsPath) : {};
  const problems: string[] = [];

  const authored = await loadDir(resolve(CUR, 'heroes'), ProfileZ, problems);
  const reviewed = await loadDir(resolve(CUR, 'review'), ReviewZ, problems);
  const adjudicated = await loadDir(resolve(CUR, 'adjudication'), AdjZ, problems);

  const profiles: HeroProfile[] = [];
  const stat = { heroes: 0, reviewed: 0, needsReview: 0, tagsVerified: 0, tagsDisputed: 0, tagsAdjudicated: 0, quoteInvalidA: 0, quoteInvalidB: 0, agreeNum: 0, agreeDen: 0, proseOk: 0, proseDropped: 0, proseUnreviewed: 0 };
  const perHero: { id: number; name: string; agree: number; union: number }[] = [];

  for (const h of heroes) {
    const a = authored.get(h.id);
    if (!a) continue;
    stat.heroes++;
    const skillBySlot = new Map(h.skills.map((s) => [s.slot, s]));

    const validTags = (tags: z.infer<typeof TagZ>[], who: 'A' | 'B') => {
      const seen = new Map<string, z.infer<typeof TagZ>>();
      for (const t of tags) {
        const skill = skillBySlot.get(t.slot);
        const ok = vocab.has(t.tag) && skill && norm(t.quote).length >= 4 && norm(skill.desc).includes(norm(t.quote));
        if (!ok) {
          who === 'A' ? stat.quoteInvalidA++ : stat.quoteInvalidB++;
          problems.push(`${h.name} ${who} 标签无效（词表/技能/原文对不上）: ${t.tag} ${t.slot} “${t.quote}”`);
          continue;
        }
        seen.set(`${t.tag}@${t.slot}`, t);
      }
      return seen;
    };

    const ta = validTags(a.tags, 'A');
    const r = reviewed.get(h.id);
    const tb = r ? validTags(r.tags, 'B') : new Map<string, z.infer<typeof TagZ>>();
    const adj = new Map((adjudicated.get(h.id)?.decisions ?? []).map((d) => [`${d.tag}@${d.slot}`, d]));
    if (r) stat.reviewed++;

    const tags: ProfileTag[] = [];
    const keys = new Set([...ta.keys(), ...tb.keys()]);
    let agree = 0;
    for (const k of keys) {
      const inA = ta.get(k);
      const inB = tb.get(k);
      const base = (inA ?? inB)!;
      let status: ProfileTag['status'];
      if (!r) status = 'unverified';
      else if (inA && inB) {
        status = 'verified';
        agree++;
      } else {
        const d = adj.get(k);
        if (d?.verdict === 'accept') {
          status = 'verified';
          stat.tagsAdjudicated++;
        } else if (d?.verdict === 'reject') continue;
        else status = 'disputed';
      }
      if (status === 'verified') stat.tagsVerified++;
      if (status === 'disputed') stat.tagsDisputed++;
      tags.push({ tag: base.tag, slot: base.slot, quote: base.quote, status });
    }
    if (r) {
      stat.agreeNum += agree;
      stat.agreeDen += keys.size;
      perHero.push({ id: h.id, name: h.name, agree, union: keys.size });
    }
    // 依赖关系：cc_hard_aoe / suppress 需要同技能的 cc_hard 已核实
    const verifiedSet = new Set(tags.filter((t) => t.status === 'verified').map((t) => `${t.tag}@${t.slot}`));
    for (const t of tags) {
      if ((t.tag === 'cc_hard_aoe' || t.tag === 'suppress') && t.status === 'verified' && !verifiedSet.has(`cc_hard@${t.slot}`)) {
        t.status = 'disputed';
        stat.tagsVerified--;
        stat.tagsDisputed++;
      }
    }

    // 说明文字
    const verdict = new Map((r?.prose ?? []).map((p) => [`${p.field}#${p.index}`, p]));
    const filterProse = <T extends { text?: string; why?: string; quote?: string; refs?: string[]; order?: string[] }>(field: string, items: T[]): (T & { status: ProseItem['status'] })[] => {
      const out: (T & { status: ProseItem['status'] })[] = [];
      items.forEach((it, i) => {
        const text = it.text ?? it.why ?? '';
        const slots = [...(it.refs ?? []), ...(it.order ?? [])];
        const badRef = slots.some((s) => !skillBySlot.has(s) && s !== '普攻');
        const allDesc = norm(h.skills.map((s) => s.desc).join('\n'));
        const badQuote = it.quote !== undefined && !allDesc.includes(norm(it.quote));
        const v = verdict.get(`${field}#${i}`);
        if (badRef || badQuote || BANNED.test(text) || v?.verdict === 'unsupported') {
          stat.proseDropped++;
          if (badRef || badQuote || BANNED.test(text)) problems.push(`${h.name} ${field}#${i} 被脚本丢弃（引用/原文/禁用词）: ${text.slice(0, 40)}`);
          return;
        }
        if (!v) {
          stat.proseUnreviewed++;
          out.push({ ...it, status: 'unverified' });
        } else {
          stat.proseOk++;
          out.push({ ...it, status: 'verified' });
        }
      });
      return out;
    };

    const summaryV = verdict.get('summary#0');
    const stale = stamps[h.id] !== undefined && stamps[h.id] !== h.skillHash;
    if (stale) stat.needsReview++;
    if (stamp && !stale) stamps[h.id] = h.skillHash;

    profiles.push({
      id: h.id,
      status: stale ? 'needs_review' : r ? 'verified' : 'unverified',
      skillHash: stamps[h.id] ?? h.skillHash,
      tags: tags.sort((x, y) => x.slot.localeCompare(y.slot) || x.tag.localeCompare(y.tag)),
      summary: summaryV?.verdict === 'unsupported' || BANNED.test(a.summary) ? '' : a.summary,
      strengths: filterProse('strengths', a.strengths),
      weaknesses: filterProse('weaknesses', a.weaknesses),
      combos: filterProse('combos', a.combos),
      interactions: filterProse('interactions', a.interactions),
    });
  }

  if (stamp) await writeJson(stampsPath, stamps);
  const missing = heroes.filter((h) => !authored.has(h.id)).map((h) => h.name);
  const report = {
    generatedAt: new Date().toISOString(),
    ...stat,
    tagAgreement: stat.agreeDen ? +(stat.agreeNum / stat.agreeDen).toFixed(4) : null,
    missing,
    lowAgreement: perHero.filter((p) => p.union >= 4 && p.agree / p.union < 0.6).map((p) => `${p.name} ${p.agree}/${p.union}`),
  };
  await writeJson(resolve(ROOT, 'data/derived/profiles.json'), { generatedAt: report.generatedAt, profiles });
  await writeJson(resolve(ROOT, 'data/derived/profile-report.json'), report);

  console.log(
    `档案 ${stat.heroes}/${heroes.length}（已盲审 ${stat.reviewed}，待复核 ${stat.needsReview}）；标签 verified ${stat.tagsVerified}（其中裁定 ${stat.tagsAdjudicated}） disputed ${stat.tagsDisputed}；` +
      `一致率 ${report.tagAgreement ?? 'n/a'}（${stat.agreeNum}/${stat.agreeDen}）；原文对不上 A ${stat.quoteInvalidA} B ${stat.quoteInvalidB}；说明文字 保留 ${stat.proseOk} 丢弃 ${stat.proseDropped} 未审 ${stat.proseUnreviewed}`,
  );
  if (report.lowAgreement.length) console.log('一致率偏低：', report.lowAgreement.join('，'));
  if (problems.length) console.log(problems.slice(0, 60).join('\n') + (problems.length > 60 ? `\n……共 ${problems.length} 条` : ''));
}

main();
