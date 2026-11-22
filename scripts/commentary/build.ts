// 汇总解说提炼条目：data/curated/commentary/*.json → data/derived/commentary.json（进仓库，只含提炼结论与来源链接）。
//
// 自动核实规则（条目默认 unverified，不参与计分）：
//   - 与已有的官方关系或机制规则方向一致（同类型、同方向的关系已有已核实证据）→ verified
//   - 同一条主张（类型、双方英雄相同）出现在两个以上不同UP主的视频里 → verified
//   - 与已有关系方向相反（已有“b克制a”的已核实证据）→ disputed，仅在研究模式展示
// 用法：tsx scripts/commentary/build.ts
import { resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { z } from 'zod';
import { ROOT, exists, readJson, writeJson } from '../lib/http.ts';
import { assemble, loadInputs } from '../lib/assemble.ts';
import { buildRelations } from '../../src/engine/relations.ts';
import type { CommentaryItem } from '../../src/types.ts';

const DIR = resolve(ROOT, 'data/curated/commentary');
const FileZ = z.object({
  bvid: z.string().regex(/^BV[0-9A-Za-z]+$/),
  title: z.string(),
  uploader: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(
    z.object({
      type: z.enum(['counter', 'synergy', 'tip']),
      a: z.string(),
      b: z.string().nullable().default(null),
      claim: z.string().min(4).max(120),
      t: z.number().nullable().default(null),
    }),
  ),
});
const BANNED = /胜率|T0|T1|版本答案|无敌|必选|必ban/i;

async function main() {
  const inputs = await loadInputs();
  const { bundle } = assemble({ ...inputs, commentary: [] });
  const rel = buildRelations(bundle, (id) => id);
  const byName = new Map(bundle.heroes.map((h) => [h.name, h.id]));
  for (const h of bundle.heroes) for (const a of h.aliases) if (!byName.has(a)) byName.set(a, h.id);

  const items: (CommentaryItem & { key: string })[] = [];
  const problems: string[] = [];
  const files = (await exists(DIR)) ? (await readdir(DIR)).filter((f) => f.endsWith('.json')) : [];
  for (const f of files) {
    const parsed = FileZ.safeParse(await readJson(resolve(DIR, f)));
    if (!parsed.success) {
      problems.push(`${f}: 格式错误 ${parsed.error.message.slice(0, 160)}`);
      continue;
    }
    const v = parsed.data;
    v.items.forEach((it, i) => {
      const a = byName.get(it.a);
      const b = it.b ? byName.get(it.b) : null;
      if (!a || (it.b && !b)) return void problems.push(`${f}#${i}: 英雄名无法识别（${it.a}${it.b ? ` / ${it.b}` : ''}）`);
      if (it.type !== 'tip' && !b) return void problems.push(`${f}#${i}: 克制/配合条目缺少第二个英雄`);
      if (BANNED.test(it.claim)) return void problems.push(`${f}#${i}: 含强度断言，已丢弃：${it.claim.slice(0, 30)}`);
      const [x, y] = it.type === 'synergy' && b != null && a > b ? [b, a] : [a, b ?? null];
      items.push({
        id: `${v.bvid}-${i}`,
        key: `${it.type}:${x}:${y}`,
        type: it.type,
        a: x,
        b: y,
        claim: it.claim,
        url: `https://www.bilibili.com/video/${v.bvid}${it.t != null ? `?t=${Math.floor(it.t)}` : ''}`,
        title: v.title,
        uploader: v.uploader,
        t: it.t,
        date: v.date,
        status: 'unverified',
      });
    });
  }

  // 自动核实
  const uploaders = new Map<string, Set<string>>();
  for (const it of items) {
    const s = uploaders.get(it.key) ?? new Set();
    s.add(it.uploader);
    uploaders.set(it.key, s);
  }
  for (const it of items) {
    if (it.type === 'tip' || it.b == null) continue;
    const same = it.type === 'counter' ? rel.getCounter(it.a, it.b) : rel.getSynergy(it.a, it.b);
    const opposite = it.type === 'counter' ? rel.getCounter(it.b, it.a) : undefined;
    if ((same?.weight ?? 0) > 0 || uploaders.get(it.key)!.size >= 2) it.status = 'verified';
    else if ((opposite?.weight ?? 0) > 0) it.status = 'disputed';
  }

  const out = items.map(({ key: _key, ...rest }) => rest);
  await writeJson(resolve(ROOT, 'data/derived/commentary.json'), { generatedAt: new Date().toISOString(), videos: files.length, items: out });
  const n = (s: string) => out.filter((i) => i.status === s).length;
  console.log(`解说：视频 ${files.length} 个，条目 ${out.length} 条（已核实 ${n('verified')}，存疑 ${n('disputed')}，未核实 ${n('unverified')}），丢弃 ${problems.length} 条`);
  if (problems.length) console.log(problems.slice(0, 20).join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
