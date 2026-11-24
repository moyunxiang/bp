// 对线档案：从教学视频字幕里提炼“清线抢线快慢、对线强弱、射辅组合强弱、前期强弱”的说法。
// 官方职业赛接口只有终局数据，没有分时段经济，所以对线强弱只能来自解说的明确说法；每条都要有字幕出处，并经另一个模型独立复核。
//   --prepare          生成提炼输入 data/raw/commentary/laning/inputs/batch-N.md（含字幕片段，不进仓库）；
//                      加 --only=专题视频 或 --only=按英雄（补充） 只重写这一类批次
//   --check=1,2        核对 data/raw/commentary/laning/claims-N.json 的格式和出处，不写任何文件（提炼时自查用）
//   --review-prepare   生成复核输入 data/raw/commentary/laning/review/batch-N.md；已有结论的条目不再生成
//   --review-apply     读取 review/verdict-*.json，合并到 data/curated/laning-review.json（只有结论和理由）
//   --build            核对全部说法，丢弃出处对不上或复核剔除的，汇总写入 data/curated/laning.json（不含字幕原文）
// 规范见 docs/curation/laning.md。
import { resolve } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { z } from 'zod';
import { RAW, ROOT, exists, readJson, writeFileSafe, writeJson } from '../lib/http.ts';
import type { LaneAspect, LaneClaim, LaneLevel, LaningData, OfficialHero } from '../../src/types.ts';
import type { HeroVideo } from './hero-guides.ts';
import type { LaneVideo } from './lane-videos.ts';

const DIR = resolve(RAW, 'commentary');
const WORK = resolve(DIR, 'laning');
const REVIEW_OUT = resolve(ROOT, 'data/curated/laning-review.json');
const OUT = resolve(ROOT, 'data/curated/laning.json');
const WINDOW = 60;
const BATCH_CHARS = 52000;
const CONTEXT_LINES = 8;
const PER_REVIEW_BATCH = 60;
/** 出现这些词的字幕行及其前后几行会进入按英雄的提炼输入 */
const KEYWORD = /对线|抢线|清线|清兵|线权|前期|[一二四124]级|强势期|弱势|压制|换血|单杀|打不过|打得过|抗压|开局|河道|射辅|压塔|塔下|发育期/;
const LANES = ['对抗路', '中路', '发育路', '游走', '打野'] as const;
const ASPECTS = ['clear', 'lane', 'duo', 'early'] as const;
const LEVELS = ['strong', 'weak', 'even'] as const;
const HERO_TYPE: Record<number, string> = { 1: '战士', 2: '法师', 3: '坦克', 4: '刺客', 5: '射手', 6: '辅助' };

const ClaimZ = z.object({
  hero: z.string(),
  aspect: z.enum(ASPECTS),
  level: z.enum(LEVELS),
  vs: z.string().nullish(),
  with: z.string().nullish(),
  lane: z.enum(LANES).nullish(),
  claim: z.string().min(4).max(90),
  ref: z.object({ bvid: z.string(), t: z.number(), quote: z.string() }),
});
type RawClaim = z.infer<typeof ClaimZ>;
const VerdictZ = z.array(z.object({ key: z.string(), verdict: z.enum(['keep', 'drop']), reason: z.string().max(120) }));
const BANNED = /胜率|T0|T1|版本答案|必选|必ban|非ban必选/i;

const squash = (s: string) => s.replace(/[\s，。、！？!?,.：:；;“”"'‘’（）()【】\[\]…~—-]/g, '').toLowerCase();
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const numbered = async (dir: string, re: RegExp) => ((await exists(dir)) ? (await readdir(dir)).filter((f) => re.test(f)).sort((a, b) => parseInt(a.replace(/\D+/g, '')) - parseInt(b.replace(/\D+/g, ''))) : []);
export const claimKey = (c: { hero: string; aspect: string; vs?: string | null; with?: string | null; ref: { bvid: string; t: number } }) =>
  `${c.hero}|${c.aspect}|${c.vs ?? ''}|${c.with ?? ''}|${c.ref.bvid}|${Math.floor(c.ref.t)}`;

interface Video {
  bvid: string;
  title: string;
  uploader: string;
  mid: number;
  pubdate: string;
  seconds: number;
  /** 这个视频是讲哪个英雄的；专题视频为空 */
  heroId?: number;
}

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

async function loadContext() {
  const { heroes } = await readJson<{ heroes: OfficialHero[] }>(resolve(ROOT, 'data/derived/official/heroes.json'));
  const { aliases } = await readJson<{ aliases: Record<string, string[]> }>(resolve(ROOT, 'data/curated/aliases.json'));
  const byName = new Map(heroes.map((h) => [h.name, h.id]));
  for (const [name, list] of Object.entries(aliases)) for (const a of list) if (!byName.has(a) && byName.has(name)) byName.set(a, byName.get(name)!);
  const heroIndex = (await exists(resolve(DIR, 'hero-videos.json'))) ? await readJson<Record<string, HeroVideo[] | boolean>>(resolve(DIR, 'hero-videos.json')) : {};
  const laneIndex = (await exists(resolve(DIR, 'lane-videos.json'))) ? (await readJson<{ videos: LaneVideo[] }>(resolve(DIR, 'lane-videos.json'))).videos : [];
  const videos = new Map<string, Video>();
  const heroVideos = new Map<number, Video[]>();
  for (const h of heroes) {
    const list = heroIndex[h.id];
    if (!Array.isArray(list)) continue;
    for (const v of list) {
      const video: Video = { bvid: v.bvid, title: v.title, uploader: v.uploader, mid: v.mid, pubdate: v.pubdate, seconds: v.seconds, heroId: h.id };
      if (!videos.has(v.bvid)) videos.set(v.bvid, video);
      heroVideos.set(h.id, [...(heroVideos.get(h.id) ?? []), video]);
    }
  }
  // 给缺说法的英雄补找的“讲对线”的视频（lane-hero-videos.ts）
  const extraIndex = (await exists(resolve(DIR, 'lane-hero-videos.json'))) ? await readJson<Record<string, HeroVideo[] | boolean>>(resolve(DIR, 'lane-hero-videos.json')) : {};
  const extraVideos = new Map<number, Video[]>();
  for (const h of heroes) {
    const list = extraIndex[h.id];
    if (!Array.isArray(list)) continue;
    for (const v of list) {
      if (videos.has(v.bvid)) continue;
      const video: Video = { bvid: v.bvid, title: v.title, uploader: v.uploader, mid: v.mid, pubdate: v.pubdate, seconds: v.seconds, heroId: h.id };
      videos.set(v.bvid, video);
      extraVideos.set(h.id, [...(extraVideos.get(h.id) ?? []), video]);
    }
  }
  const topicVideos: Video[] = [];
  for (const v of laneIndex) {
    const video: Video = { bvid: v.bvid, title: v.title, uploader: v.uploader, mid: v.mid, pubdate: v.pubdate, seconds: v.seconds };
    // 同一个视频既在英雄清单里又在专题清单里时，按专题处理（整段字幕都交给提炼）
    videos.set(v.bvid, { ...video, heroId: videos.get(v.bvid)?.heroId });
    topicVideos.push(video);
  }
  const extraOrder = Object.keys(extraIndex).filter((k) => k.endsWith(':done')).map((k) => Number(k.split(':')[0]));
  return { heroes, byName, videos, heroVideos, extraVideos, extraOrder, topicVideos };
}

/** 按英雄：只保留提到对线、抢线、前期等内容的字幕行及其前后几行 */
async function heroSnippets(videos: Video[]): Promise<string[]> {
  const parts: string[] = [];
  for (const v of videos) {
    const lines = await subtitle(v.bvid);
    const keep = new Set<number>();
    lines.forEach((l, i) => {
      if (KEYWORD.test(l.text)) for (let j = Math.max(0, i - CONTEXT_LINES); j <= Math.min(lines.length - 1, i + CONTEXT_LINES); j++) keep.add(j);
    });
    if (!keep.size) continue;
    const out: string[] = [];
    let prev = -2;
    for (const i of [...keep].sort((a, b) => a - b)) {
      if (i !== prev + 1 && out.length) out.push('……');
      out.push(`${fmt(lines[i].t)} ${lines[i].text}`);
      prev = i;
    }
    parts.push(`### 视频 ${v.bvid}《${v.title}》（${v.uploader}，${v.pubdate}）`, ...out, '');
  }
  return parts;
}

async function prepare() {
  const { heroes, heroVideos, extraVideos, extraOrder, topicVideos } = await loadContext();
  const names = heroes.map((h) => h.name).join('、');
  const head = (n: number, kind: string) =>
    `# 对线档案提炼 第${n}批（${kind}）\n\n按 docs/curation/laning.md 提炼，结果写入 data/raw/commentary/laning/claims-${n}.json。\n\n## 规范英雄名（hero、vs、with 只能用这些名字）\n${names}\n`;
  const batches: { kind: string; body: string[] }[] = [];
  let cur: string[] = [];
  let size = 0;
  const flush = (kind: string) => {
    if (cur.length) batches.push({ kind, body: cur });
    cur = [];
    size = 0;
  };
  const topicSet = new Set(topicVideos.map((v) => v.bvid));
  let heroCount = 0;
  for (const h of heroes) {
    const vids = (heroVideos.get(h.id) ?? []).filter((v) => !topicSet.has(v.bvid));
    const snippets = await heroSnippets(vids);
    if (!snippets.length) continue;
    const section = [`## 英雄：${h.name}（官方职业：${[h.heroType, h.heroType2].filter(Boolean).map((t) => HERO_TYPE[t as number]).join('/')}）`, '以下视频都是在讲这个英雄，解说说的“我们”“你”通常指这个英雄的玩家。字幕只保留了提到对线、抢线、前期等内容的片段，“……”表示中间有省略。', '', ...snippets];
    const len = section.join('\n').length;
    if (size + len > BATCH_CHARS && cur.length) flush('按英雄');
    cur.push(...section);
    size += len;
    heroCount++;
  }
  flush('按英雄');
  for (const v of topicVideos) {
    const lines = await subtitle(v.bvid);
    const section = [`## 专题视频 ${v.bvid}《${v.title}》（${v.uploader}，${v.pubdate}，时长 ${v.seconds} 秒）`, '这个视频不是只讲一个英雄：每条说法的 hero 要写清楚说的是哪个英雄。', '', ...lines.map((l) => `${fmt(l.t)} ${l.text}`), ''];
    const len = section.join('\n').length;
    if (size + len > BATCH_CHARS && cur.length) flush('专题视频');
    cur.push(...section);
    size += len;
  }
  flush('专题视频');
  // 第二轮按英雄：给缺说法的英雄补找的视频，排在最后，不影响前面批次的编号
  // 按补找时的处理顺序排（清单里“id:done”键的先后），这样续跑补找之后前面已经提炼过的批次内容不变
  let extraCount = 0;
  const byId = new Map(heroes.map((h) => [h.id, h]));
  for (const id of extraOrder) {
    const h = byId.get(id);
    if (!h) continue;
    const snippets = await heroSnippets(extraVideos.get(h.id) ?? []);
    if (!snippets.length) continue;
    const section = [`## 英雄：${h.name}（官方职业：${[h.heroType, h.heroType2].filter(Boolean).map((t) => HERO_TYPE[t as number]).join('/')}）`, '以下视频都是在讲这个英雄，解说说的“我们”“你”通常指这个英雄的玩家。字幕只保留了提到对线、抢线、前期等内容的片段，“……”表示中间有省略。', '', ...snippets];
    const len = section.join('\n').length;
    if (size + len > BATCH_CHARS && cur.length) flush('按英雄（补充）');
    cur.push(...section);
    size += len;
    extraCount++;
  }
  flush('按英雄（补充）');
  // --only=专题视频 / --only=按英雄（补充）：只重写这一类批次（其他批次已经在提炼时不要动）
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
  for (const [i, b] of batches.entries()) if (!only || b.kind === only) await writeFileSafe(resolve(WORK, 'inputs', `batch-${i + 1}.md`), `${head(i + 1, b.kind)}\n${b.body.join('\n')}\n`);
  console.log(`已生成 ${batches.length} 批提炼输入（按英雄 ${batches.filter((b) => b.kind === '按英雄').length} 批、共 ${heroCount} 个英雄；专题视频 ${batches.filter((b) => b.kind === '专题视频').length} 批、共 ${topicVideos.length} 个视频；按英雄（补充） ${batches.filter((b) => b.kind === '按英雄（补充）').length} 批、共 ${extraCount} 个英雄）：data/raw/commentary/laning/inputs/`);
  console.log(batches.map((b, i) => `${i + 1}:${b.kind}:${Math.round(b.body.join('\n').length / 1000)}千字`).join(' '));
}

interface Checked extends RawClaim {
  key: string;
  heroId: number;
  vsId?: number;
  withId?: number;
}

/** 读取并核对全部（或指定批次的）说法：格式、英雄名、出处逐字存在 */
async function loadClaims(only?: string[]) {
  const { heroes, byName, videos, heroVideos, extraVideos, topicVideos } = await loadContext();
  const files = (await numbered(WORK, /^claims-\d+\.json$/)).filter((f) => !only || only.includes(f.replace(/\D+/g, '')));
  const ok: Checked[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const f of files) {
    const raw = await readJson<unknown>(resolve(WORK, f)).catch(() => null);
    if (!Array.isArray(raw)) {
      problems.push(`${f}: 不是合法的JSON数组`);
      continue;
    }
    for (const [i, item] of raw.entries()) {
      total++;
      const where = `${f}#${i}`;
      const parsed = ClaimZ.safeParse(item);
      if (!parsed.success) {
        problems.push(`${where}: 格式错误 ${parsed.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('；').slice(0, 160)}`);
        continue;
      }
      const c = parsed.data;
      const heroId = byName.get(c.hero);
      const vsId = c.vs ? byName.get(c.vs) : undefined;
      const withId = c.with ? byName.get(c.with) : undefined;
      if (!heroId || (c.vs && !vsId) || (c.with && !withId)) {
        problems.push(`${where}: 英雄名无法识别（${[c.hero, c.vs, c.with].filter(Boolean).join('、')}）`);
        continue;
      }
      if (vsId === heroId || withId === heroId) {
        problems.push(`${where}: vs/with 不能是英雄自己`);
        continue;
      }
      if (c.with && c.aspect !== 'duo' && c.aspect !== 'clear') {
        problems.push(`${where}: with 只能用在 duo 或 clear`);
        continue;
      }
      if (BANNED.test(c.claim)) {
        problems.push(`${where}: claim 里有禁用表述`);
        continue;
      }
      const v = videos.get(c.ref.bvid);
      const q = squash(c.ref.quote);
      if (!v || q.length < 4) {
        problems.push(`${where}: 视频不在清单里或 quote 太短（${c.ref.bvid}）`);
        continue;
      }
      const near = (await subtitle(c.ref.bvid)).filter((l) => Math.abs(l.t - c.ref.t) <= WINDOW);
      if (!squash(near.map((l) => l.text).join('')).includes(q)) {
        problems.push(`${where}: 出处对不上 ${c.hero} ${c.ref.bvid}@${c.ref.t} “${c.ref.quote.slice(0, 16)}”`);
        continue;
      }
      const key = claimKey(c);
      if (seen.has(key)) continue;
      seen.add(key);
      ok.push({ ...c, key, heroId, vsId, withId });
    }
  }
  return { ok, problems, total, files, heroes, videos, heroVideos, extraVideos, topicVideos };
}

async function check(only: string[]) {
  const { ok, problems, total, files } = await loadClaims(only);
  console.log(`自查 ${files.length} 个文件共 ${total} 条：通过 ${ok.length} 条，有问题 ${problems.length} 条`);
  console.log(problems.length ? problems.join('\n') : '没有问题');
}

const MEANING: Record<LaneAspect, Record<LaneLevel, string>> = {
  clear: { strong: '清线、抢线快', weak: '清线、抢线慢', even: '清线、抢线速度一般' },
  lane: { strong: '对线强', weak: '对线弱', even: '对线不强不弱' },
  duo: { strong: '在发育路的双人对线里强', weak: '在发育路的双人对线里弱', even: '在发育路的双人对线里不强不弱' },
  early: { strong: '前期强', weak: '前期弱', even: '前期不强不弱' },
};
const say = (c: RawClaim) => {
  if (c.vs) return `${c.hero} 对线 ${c.vs} 时${c.level === 'strong' ? '占优' : c.level === 'weak' ? '吃亏' : '五五开'}${c.aspect === 'clear' ? '（指清线抢线）' : ''}`;
  if (c.with) return `${c.hero} 和 ${c.with} 搭档时${MEANING[c.aspect][c.level]}`;
  return `${c.hero} ${MEANING[c.aspect][c.level]}`;
};

async function loadVerdicts() {
  return (await exists(REVIEW_OUT)) ? (await readJson<{ items: { key: string; verdict: 'keep' | 'drop'; reason: string }[] }>(REVIEW_OUT)).items : [];
}

async function reviewPrepare() {
  const done = new Set((await loadVerdicts()).map((v) => v.key));
  const { ok, heroes, videos } = await loadClaims();
  const nameOf = new Map(heroes.map((h) => [h.id, h.name]));
  const items: string[] = [];
  for (const c of ok) {
    if (done.has(c.key)) continue;
    const v = videos.get(c.ref.bvid)!;
    const lines = (await subtitle(c.ref.bvid)).filter((l) => l.t >= c.ref.t - 60 && l.t <= c.ref.t + 75).map((l) => `${fmt(l.t)} ${l.text}`);
    const about = v.heroId ? `这个视频是在讲 ${nameOf.get(v.heroId)}` : '这个视频是专题视频，不只讲一个英雄';
    items.push([`## ${c.key}`, `说法：**${say(c)}**${c.lane ? `（${c.lane}）` : ''}`, `提炼出的理由：${c.claim}`, `出处：《${v.title}》（${v.uploader}）${fmt(c.ref.t)} 附近的字幕（${about}）：`, '```', ...lines, '```'].join('\n'));
  }
  const dir = resolve(WORK, 'review');
  const existing = (await exists(dir)) ? (await readdir(dir)).map((f) => Number(/^(?:batch|verdict)-(\d+)\./.exec(f)?.[1] ?? 0)) : [];
  const start = Math.max(0, ...existing);
  const n = Math.ceil(items.length / PER_REVIEW_BATCH);
  const names: number[] = [];
  for (let i = 0; i < n; i++) {
    names.push(start + i + 1);
    await writeFileSafe(
      resolve(dir, `batch-${start + i + 1}.md`),
      `# 对线说法复核 第${start + i + 1}批\n\n按 docs/curation/laning.md 的“复核”一节逐条判断，结论写入 data/raw/commentary/laning/review/verdict-${start + i + 1}.json。\n\n${items.slice(i * PER_REVIEW_BATCH, (i + 1) * PER_REVIEW_BATCH).join('\n\n')}\n`,
    );
  }
  console.log(`待复核 ${items.length} 条，分成 ${n} 批（编号 ${names.join('、') || '无'}）；已有结论的 ${done.size} 条不再生成`);
}

async function reviewApply() {
  const merged = new Map((await loadVerdicts()).map((v) => [v.key, v]));
  const dir = resolve(WORK, 'review');
  const files = await numbered(dir, /^verdict-\d+\.json$/);
  let read = 0;
  for (const f of files) {
    const parsed = VerdictZ.safeParse(await readJson(resolve(dir, f)).catch(() => null));
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
  await writeJson(REVIEW_OUT, { note: '教学视频对线说法的独立复核结论。drop 的条目不进入网站。', items });
  console.log(`读取 ${files.length} 个结论文件共 ${read} 条；累计 ${items.length} 条：保留 ${items.filter((v) => v.verdict === 'keep').length}，剔除 ${items.filter((v) => v.verdict === 'drop').length}`);
}

async function build() {
  const { ok, problems, total, files, videos, heroVideos, extraVideos, topicVideos } = await loadClaims();
  // 提炼结果和字幕只在本地（data/raw，不进仓库）；没有它们时保留仓库里已有的 laning.json，不要用空结果覆盖
  if (!files.length) return void console.log('本地没有提炼结果（data/raw/commentary/laning/claims-*.json），保留已有的 data/curated/laning.json');
  const verdicts = new Map((await loadVerdicts()).map((v) => [v.key, v.verdict]));
  let dropped = 0;
  let unreviewed = 0;
  const claims: LaneClaim[] = [];
  const merged = new Map<string, LaneClaim>();
  for (const c of ok) {
    const verdict = verdicts.get(c.key);
    if (verdict === 'drop') {
      dropped++;
      continue;
    }
    // 没有复核结论的不进入网站
    if (!verdict) {
      unreviewed++;
      continue;
    }
    // 同一个视频对同一件事说了几次，只算一条
    const k = `${c.heroId}|${c.aspect}|${c.vsId ?? ''}|${c.withId ?? ''}|${c.level}|${c.ref.bvid}`;
    if (merged.has(k)) continue;
    const item: LaneClaim = { hero: c.heroId, aspect: c.aspect, level: c.level, claim: c.claim, bvid: c.ref.bvid, t: Math.max(0, Math.floor(c.ref.t)) };
    if (c.vsId) item.vs = c.vsId;
    if (c.withId) item.with = c.withId;
    if (c.lane) item.lane = c.lane;
    merged.set(k, item);
    claims.push(item);
  }
  claims.sort((a, b) => a.hero - b.hero || a.aspect.localeCompare(b.aspect) || a.bvid.localeCompare(b.bvid) || a.t - b.t);
  const used = new Set(claims.map((c) => c.bvid));
  // 转载识别：两个视频的字幕大部分相同（8字片段重合超过六成）时，是同一段内容被不同账号发布，只能算一个来源。
  // 做法：把较晚发布的那个视频的来源记成较早那个的UP主，并注明 sameAs。
  const grams = new Map<string, Set<string>>();
  for (const bvid of used) {
    const text = squash((await subtitle(bvid)).map((l) => l.text).join(''));
    const set = new Set<string>();
    for (let i = 0; i + 8 <= text.length; i++) set.add(text.slice(i, i + 8));
    grams.set(bvid, set);
  }
  const sameAs = new Map<string, string>();
  const ordered = [...used].sort((a, b) => videos.get(a)!.pubdate.localeCompare(videos.get(b)!.pubdate) || a.localeCompare(b));
  for (const [i, later] of ordered.entries())
    for (const earlier of ordered.slice(0, i)) {
      if (sameAs.has(earlier)) continue;
      const x = grams.get(later)!;
      const y = grams.get(earlier)!;
      const small = Math.min(x.size, y.size);
      if (!small) continue;
      let both = 0;
      for (const g of x) if (y.has(g)) both++;
      if (both / small > 0.6) {
        sameAs.set(later, earlier);
        break;
      }
    }
  // 转载视频里和原视频说的是同一件事的说法只留原视频那一条（否则同一句话会显示两遍）
  const sig = (c: LaneClaim, bvid: string) => `${c.hero}|${c.aspect}|${c.vs ?? ''}|${c.with ?? ''}|${c.level}|${bvid}`;
  const have = new Set(claims.map((c) => sig(c, c.bvid)));
  const repeated = claims.filter((c) => sameAs.has(c.bvid) && have.has(sig(c, sameAs.get(c.bvid)!)));
  for (const c of repeated) claims.splice(claims.indexOf(c), 1);
  const cited = new Set(claims.map((c) => c.bvid));
  const data: LaningData = {
    generatedAt: new Date().toISOString(),
    scope: { heroVideos: [...heroVideos.values(), ...extraVideos.values()].flat().length, topicVideos: topicVideos.length, extracted: total, verified: ok.length, reviewDropped: dropped, kept: claims.length },
    videos: Object.fromEntries(
      [...videos.values()]
        .filter((v) => cited.has(v.bvid))
        .map((v) => {
          const origin = sameAs.get(v.bvid);
          return [v.bvid, { title: v.title, uploader: v.uploader, mid: origin ? videos.get(origin)!.mid : v.mid, date: v.pubdate, ...(origin ? { sameAs: origin } : {}) }];
        }),
    ),
    claims,
  };
  await writeJson(OUT, data);
  console.log(`提炼 ${total} 条：出处核对通过 ${ok.length}，复核剔除 ${dropped}，未复核 ${unreviewed}（不进入网站），写入 ${claims.length} 条，涉及 ${new Set(claims.map((c) => c.hero)).size} 个英雄、${cited.size} 个视频`);
  if (sameAs.size) console.log(`内容重复的视频（按同一个来源计）：${[...sameAs].map(([a, b]) => `${a}≈${b}`).join('、')}；去掉重复说法 ${repeated.length} 条`);
  if (problems.length) console.log(problems.slice(0, 30).join('\n') + (problems.length > 30 ? `\n…另有 ${problems.length - 30} 条` : ''));
}

const checkArg = process.argv.find((a) => a.startsWith('--check='))?.slice(8).split(',');
const run = checkArg
  ? () => check(checkArg)
  : process.argv.includes('--prepare')
    ? prepare
    : process.argv.includes('--review-prepare')
      ? reviewPrepare
      : process.argv.includes('--review-apply')
        ? reviewApply
        : process.argv.includes('--build')
          ? build
          : null;
if (!run) {
  console.log('用法：tsx scripts/commentary/laning.ts --prepare | --check=N[,N] | --review-prepare | --review-apply | --build');
  process.exit(2);
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
