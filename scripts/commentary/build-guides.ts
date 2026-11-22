// 核对并汇总英雄教学提炼结果（连招、细节、克制关系）。
//   输入：data/raw/commentary/distilled/{英雄ID}.json（子任务按 docs/curation/guides.md 写的，含字幕引用，不进仓库）
//   核对：每条出处的 quote 必须逐字出现在该视频 t 前后60秒的字幕里；连招里的数字必须对应该英雄存在的技能；
//         对不上的出处丢弃，一个有效出处都没有的条目丢弃。
//         克制/配合说法另有一轮独立复核（review-matchups.ts），结论为 drop 的丢弃。
//   输出：data/curated/guides/{英雄ID}.json（进仓库：只有提炼后的结论和视频链接，不含字幕原文）
//         data/derived/guides.json（汇总，供数据包使用）
// 用法：tsx scripts/commentary/build-guides.ts              核对全部并写入
//       tsx scripts/commentary/build-guides.ts --check=125,131  只核对这几个英雄，不写任何文件（提炼时自查用）
import { resolve } from 'node:path';
import { readdir, readFile, rm } from 'node:fs/promises';
import { z } from 'zod';
import { RAW, ROOT, exists, readJson, writeJson } from '../lib/http.ts';
import type { GuideRef, HeroGuide, OfficialHero } from '../../src/types.ts';
import type { HeroVideo } from './hero-guides.ts';

const DIR = resolve(RAW, 'commentary');
const OUT = resolve(ROOT, 'data/curated/guides');
const WINDOW = 60;
const CHECK = process.argv.find((a) => a.startsWith('--check='))?.slice(8).split(',');

const RefZ = z.object({ bvid: z.string(), t: z.number(), quote: z.string() });
const FileZ = z.object({
  id: z.number(),
  name: z.string(),
  combos: z.array(z.object({ steps: z.array(z.string().min(1).max(8)).min(2).max(14), name: z.string().max(20), level: z.enum(['基础', '进阶']).catch('基础'), note: z.string().max(100).default(''), refs: z.array(RefZ) })).default([]),
  tips: z.array(z.object({ title: z.string().min(2).max(20), text: z.string().min(6).max(130), refs: z.array(RefZ) })).default([]),
  matchups: z.array(z.object({ type: z.enum(['counter', 'countered', 'synergy']), hero: z.string(), claim: z.string().min(4).max(100), refs: z.array(RefZ) })).default([]),
});
const BANNED = /胜率|T0|T1|版本答案|必选|必ban|非ban必选/i;
const squash = (s: string) => s.replace(/[\s，。、！？!?,.：:；;“”"'‘’（）()【】\[\]…~—-]/g, '').toLowerCase();

const subtitleCache = new Map<string, { t: number; text: string }[]>();
async function subtitle(bvid: string) {
  if (!subtitleCache.has(bvid)) {
    const file = resolve(DIR, 'subtitles', `${bvid}.txt`);
    const lines: { t: number; text: string }[] = [];
    if (await exists(file)) {
      for (const line of (await readFile(file, 'utf-8')).split('\n')) {
        const m = /^(\d+):(\d\d) (.*)$/.exec(line);
        if (m) lines.push({ t: Number(m[1]) * 60 + Number(m[2]), text: m[3] });
      }
    }
    subtitleCache.set(bvid, lines);
  }
  return subtitleCache.get(bvid)!;
}

async function main() {
  const { heroes } = await readJson<{ heroes: OfficialHero[] }>(resolve(ROOT, 'data/derived/official/heroes.json'));
  const { aliases } = await readJson<{ aliases: Record<string, string[]> }>(resolve(ROOT, 'data/curated/aliases.json'));
  const byId = new Map(heroes.map((h) => [h.id, h]));
  const byName = new Map(heroes.map((h) => [h.name, h.id]));
  for (const [name, list] of Object.entries(aliases)) for (const a of list) if (!byName.has(a) && byName.has(name)) byName.set(a, byName.get(name)!);
  const index = (await exists(resolve(DIR, 'hero-videos.json'))) ? await readJson<Record<string, HeroVideo[] | boolean>>(resolve(DIR, 'hero-videos.json')) : {};

  const distilled = resolve(DIR, 'distilled');
  const files = ((await exists(distilled)) ? (await readdir(distilled)).filter((f) => /^\d+\.json$/.test(f)) : []).filter((f) => !CHECK || CHECK.includes(f.replace('.json', '')));
  const stats = { heroes: 0, combos: 0, tips: 0, matchups: 0, droppedItems: 0, droppedRefs: 0, badFiles: 0, reviewDropped: 0, unreviewed: 0 };
  // 克制说法的独立复核结论：键为 `${英雄ID}|${type}|${对方英雄名}`
  const reviewFile = resolve(ROOT, 'data/curated/guides-review.json');
  const review = new Map(((await exists(reviewFile)) ? (await readJson<{ items: { key: string; verdict: 'keep' | 'drop' }[] }>(reviewFile)).items : []).map((v) => [v.key, v.verdict]));
  const problems: string[] = [];

  for (const f of files) {
    const parsed = FileZ.safeParse(await readJson(resolve(distilled, f)).catch(() => null));
    const hero = byId.get(Number(f.replace('.json', '')));
    if (!parsed.success || !hero) {
      stats.badFiles++;
      problems.push(`${f}: 格式错误 ${parsed.success ? '未知英雄' : parsed.error.message.slice(0, 200)}`);
      continue;
    }
    const videos = (Array.isArray(index[hero.id]) ? (index[hero.id] as HeroVideo[]) : []).filter(Boolean);
    const videoOf = new Map(videos.map((v) => [v.bvid, v]));
    const slots = new Set(hero.skills.map((s) => s.slot));

    const checkRefs = async (refs: z.infer<typeof RefZ>[], where: string): Promise<GuideRef[]> => {
      const ok: GuideRef[] = [];
      for (const r of refs) {
        const v = videoOf.get(r.bvid);
        const q = squash(r.quote);
        if (!v || q.length < 4) {
          stats.droppedRefs++;
          continue;
        }
        const near = (await subtitle(r.bvid)).filter((l) => Math.abs(l.t - r.t) <= WINDOW);
        if (!squash(near.map((l) => l.text).join('')).includes(q)) {
          stats.droppedRefs++;
          problems.push(`${hero.name} ${where}: 出处对不上 ${r.bvid}@${r.t} “${r.quote.slice(0, 16)}”`);
          continue;
        }
        if (!ok.some((x) => x.bvid === r.bvid)) ok.push({ bvid: r.bvid, t: Math.max(0, Math.floor(r.t)) });
      }
      return ok;
    };
    const used = new Set<string>();
    const keep = <T extends { refs: GuideRef[] }>(item: T): T & { sources: number } => {
      item.refs.forEach((r) => used.add(r.bvid));
      return { ...item, sources: new Set(item.refs.map((r) => videoOf.get(r.bvid)!.mid)).size };
    };

    const guide: HeroGuide = { id: hero.id, videos: [], combos: [], tips: [], matchups: [] };
    for (const [i, c] of parsed.data.combos.entries()) {
      const badStep = c.steps.find((s) => /^\d$/.test(s) && !slots.has(`${s}技能`));
      const refs = badStep ? [] : await checkRefs(c.refs, `连招#${i}`);
      if (badStep) problems.push(`${hero.name} 连招#${i}: 没有“${badStep}技能”`);
      if (!refs.length || BANNED.test(c.name + c.note)) stats.droppedItems++;
      else guide.combos.push(keep({ steps: c.steps, name: c.name, level: c.level, note: c.note, refs }));
    }
    for (const [i, t] of parsed.data.tips.entries()) {
      const refs = await checkRefs(t.refs, `细节#${i}`);
      if (!refs.length || BANNED.test(t.title + t.text)) stats.droppedItems++;
      else guide.tips.push(keep({ title: t.title, text: t.text, refs }));
    }
    for (const [i, m] of parsed.data.matchups.entries()) {
      const other = byName.get(m.hero);
      const refs = other && other !== hero.id ? await checkRefs(m.refs, `克制#${i}`) : [];
      if (!other) problems.push(`${hero.name} 克制#${i}: 英雄名无法识别（${m.hero}）`);
      const verdict = review.get(`${hero.id}|${m.type}|${m.hero}`);
      if (!refs.length || BANNED.test(m.claim)) stats.droppedItems++;
      else if (verdict === 'drop') stats.reviewDropped++;
      else {
        if (!verdict) stats.unreviewed++;
        guide.matchups.push(keep({ type: m.type, hero: other!, claim: m.claim, refs }));
      }
    }
    guide.videos = videos.filter((v) => used.has(v.bvid)).map((v) => ({ bvid: v.bvid, title: v.title, uploader: v.uploader, date: v.pubdate, seconds: v.seconds }));
    if (!guide.combos.length && !guide.tips.length && !guide.matchups.length) {
      // 重新提炼后没有内容了：去掉以前生成的文件，避免旧内容留在网站上
      if (!CHECK) await rm(resolve(OUT, `${hero.id}.json`), { force: true });
      continue;
    }
    if (!CHECK) await writeJson(resolve(OUT, `${hero.id}.json`), guide);
    stats.heroes++;
    stats.combos += guide.combos.length;
    stats.tips += guide.tips.length;
    stats.matchups += guide.matchups.length;
  }

  if (CHECK) {
    console.log(`自查 ${files.length} 个提炼文件：通过 ${stats.heroes} 个英雄，连招 ${stats.combos}、细节 ${stats.tips}、克制关系 ${stats.matchups}；丢弃条目 ${stats.droppedItems}，丢弃出处 ${stats.droppedRefs}，格式错误 ${stats.badFiles}`);
    console.log(problems.length ? problems.join('\n') : '没有问题');
    return;
  }
  // 汇总 data/curated/guides 下的全部文件（包括以前生成、这次没有重新提炼的）
  const all: HeroGuide[] = [];
  if (await exists(OUT)) for (const f of (await readdir(OUT)).filter((x) => x.endsWith('.json')).sort((a, b) => parseInt(a) - parseInt(b))) all.push(await readJson<HeroGuide>(resolve(OUT, f)));
  await writeJson(resolve(ROOT, 'data/derived/guides.json'), { generatedAt: new Date().toISOString(), guides: all });
  console.log(`本次核对 ${files.length} 个提炼文件：通过 ${stats.heroes} 个英雄，连招 ${stats.combos}、细节 ${stats.tips}、克制关系 ${stats.matchups}；丢弃条目 ${stats.droppedItems}，丢弃出处 ${stats.droppedRefs}，格式错误 ${stats.badFiles}`);
  console.log(`克制说法复核：剔除 ${stats.reviewDropped} 条${stats.unreviewed ? `；还有 ${stats.unreviewed} 条没有复核结论（先按保留处理，运行 review-matchups.ts --prepare 生成复核输入）` : ''}`);
  console.log(`汇总：共 ${all.length} 个英雄有教学内容`);
  if (problems.length) console.log(problems.slice(0, 40).join('\n') + (problems.length > 40 ? `\n…另有 ${problems.length - 40} 条` : ''));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
