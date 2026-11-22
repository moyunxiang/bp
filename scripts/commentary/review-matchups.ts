// 教学视频里的克制/配合说法：独立复核。
// 提炼时容易把“遇到某英雄怎么打”误写成“克制某英雄”，或者把方向写反。这里把每条说法连同出处前后的字幕
// 交给另一个模型独立判断，只保留解说确实这么说、方向也一致的条目。
//   --prepare  生成复核输入 data/raw/commentary/review/batch-N.md（含字幕片段，不进仓库）；已有结论的条目不再生成
//   --apply    读取 data/raw/commentary/review/verdict-*.json，合并到 data/curated/guides-review.json（只有结论和理由）
// 复核规范见 docs/curation/guides.md 的“克制说法复核”。build-guides.ts 会丢弃结论为 drop 的条目。
import { resolve } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { z } from 'zod';
import { RAW, ROOT, exists, readJson, writeFileSafe, writeJson } from '../lib/http.ts';
import type { HeroVideo } from './hero-guides.ts';

const DIR = resolve(RAW, 'commentary');
const REVIEW = resolve(DIR, 'review');
const OUT = resolve(ROOT, 'data/curated/guides-review.json');
const PER_BATCH = 45;
const BEFORE = 75;
const AFTER = 105;

export interface MatchupVerdict {
  /** `${英雄ID}|${type}|${对方英雄名}` */
  key: string;
  verdict: 'keep' | 'drop';
  reason: string;
}
const VerdictZ = z.array(z.object({ key: z.string(), verdict: z.enum(['keep', 'drop']), reason: z.string().max(120) }));

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const MEANING = { counter: (a: string, b: string) => `${a} 克制 ${b}`, countered: (a: string, b: string) => `${a} 被 ${b} 克制`, synergy: (a: string, b: string) => `${a} 和 ${b} 配合好` };

async function loadVerdicts(): Promise<MatchupVerdict[]> {
  return (await exists(OUT)) ? (await readJson<{ items: MatchupVerdict[] }>(OUT)).items : [];
}

async function prepare() {
  const done = new Set((await loadVerdicts()).map((v) => v.key));
  const index = await readJson<Record<string, HeroVideo[] | boolean>>(resolve(DIR, 'hero-videos.json'));
  const distilled = resolve(DIR, 'distilled');
  const items: string[] = [];
  for (const f of (await readdir(distilled)).filter((x) => /^\d+\.json$/.test(x)).sort((a, b) => parseInt(a) - parseInt(b))) {
    const d = await readJson<{ id: number; name: string; matchups?: { type: keyof typeof MEANING; hero: string; claim: string; refs: { bvid: string; t: number }[] }[] }>(resolve(distilled, f));
    const videos = Array.isArray(index[d.id]) ? (index[d.id] as HeroVideo[]) : [];
    for (const m of d.matchups ?? []) {
      const key = `${d.id}|${m.type}|${m.hero}`;
      if (done.has(key) || !MEANING[m.type]) continue;
      const parts = [`## ${key}`, `说法：**${MEANING[m.type](d.name, m.hero)}**`, `提炼出的理由：${m.claim}`];
      for (const r of m.refs) {
        const v = videos.find((x) => x.bvid === r.bvid);
        const file = resolve(DIR, 'subtitles', `${r.bvid}.txt`);
        if (!v || !(await exists(file))) continue;
        const lines = (await readFile(file, 'utf-8')).split('\n').filter((line) => {
          const mm = /^(\d+):(\d\d) /.exec(line);
          if (!mm) return false;
          const t = Number(mm[1]) * 60 + Number(mm[2]);
          return t >= r.t - BEFORE && t <= r.t + AFTER;
        });
        parts.push(`出处：《${v.title}》（${v.uploader}）${fmt(r.t)} 附近的字幕（这个视频是在讲 ${d.name}）：`, '```', ...lines, '```');
      }
      if (parts.length > 3) items.push(parts.join('\n'));
    }
  }
  const batches = Math.ceil(items.length / PER_BATCH);
  // 批次编号接在已有批次之后，不覆盖以前的输入和结论
  const existing = (await exists(REVIEW)) ? (await readdir(REVIEW)).map((f) => Number(/^(?:batch|verdict)-(\d+)\./.exec(f)?.[1] ?? 0)) : [];
  const start = Math.max(0, ...existing);
  const names: number[] = [];
  for (let i = 0; i < batches; i++) {
    const n = start + i + 1;
    names.push(n);
    const body = items.slice(i * PER_BATCH, (i + 1) * PER_BATCH).join('\n\n');
    await writeFileSafe(resolve(REVIEW, `batch-${n}.md`), `# 克制说法复核 第${n}批\n\n按 docs/curation/guides.md 的“克制说法复核”一节逐条判断，结论写入 data/raw/commentary/review/verdict-${n}.json。\n\n${body}\n`);
  }
  console.log(`待复核 ${items.length} 条，分成 ${batches} 批（编号 ${names.join('、') || '无'}）：data/raw/commentary/review/batch-N.md（已有结论的 ${done.size} 条不再生成）`);
}

async function apply() {
  const merged = new Map((await loadVerdicts()).map((v) => [v.key, v]));
  let read = 0;
  const files = (await exists(REVIEW)) ? (await readdir(REVIEW)).filter((f) => /^verdict-\d+\.json$/.test(f)) : [];
  for (const f of files) {
    const parsed = VerdictZ.safeParse(await readJson(resolve(REVIEW, f)).catch(() => null));
    if (!parsed.success) {
      console.log(`${f}: 格式错误，已跳过`);
      continue;
    }
    for (const v of parsed.data) {
      merged.set(v.key, v);
      read++;
    }
  }
  const items = [...merged.values()].sort((a, b) => a.key.localeCompare(b.key, 'zh'));
  await writeJson(OUT, { note: '教学视频克制/配合说法的独立复核结论。drop 的条目不进入网站。', items });
  console.log(`读取 ${files.length} 个结论文件共 ${read} 条；累计 ${items.length} 条：保留 ${items.filter((v) => v.verdict === 'keep').length}，剔除 ${items.filter((v) => v.verdict === 'drop').length}`);
}

const run = process.argv.includes('--apply') ? apply : process.argv.includes('--prepare') ? prepare : null;
if (!run) {
  console.log('用法：tsx scripts/commentary/review-matchups.ts --prepare | --apply');
  process.exit(2);
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
