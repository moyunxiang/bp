// 给“还没有对线说法”的英雄补找讲对线的视频并读取AI字幕，供提炼对线档案使用。
// 判断缺不缺：英雄常打的每一路（适配权重≥0.3）里，data/curated/laning.json 没有可用说法的就算缺。
// 原始字幕只保存在 data/raw/commentary/subtitles/（不进仓库、不公开）；清单写入 data/raw/commentary/lane-hero-videos.json。
// 需要 .env.local 里的 BILI_COOKIE。低频访问：每次请求间隔≥3秒；遇到风控（HTTP 412、返回码非0）立即停止，不重试、不绕过；可断点续跑。
// 用法：tsx scripts/commentary/lane-hero-videos.ts [--per-hero=2] [--max-heroes=200] [--heroes=吕布,貂蝉]
import { resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { RAW, ROOT, exists, fetchText, readJson, writeFileSafe, writeJson } from '../lib/http.ts';
import { biliHeaders, loadEnv } from '../lib/env.ts';
import { buildLaneIndex, laneView } from '../../src/engine/laning.ts';
import { LANES, type Bundle, type Lane, type LaneAspect } from '../../src/types.ts';
import type { HeroVideo } from './hero-guides.ts';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const PER_HERO = Number(arg('per-hero') ?? 2);
const MAX_HEROES = Number(arg('max-heroes') ?? 200);
const ONLY = arg('heroes')?.split(',');
const DIR = resolve(RAW, 'commentary');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MAX_AGE_DAYS = 500;
/** 标题带这些词的视频更可能讲到对线强弱，排在前面 */
const LANE_WORDS = /对线|抢线|线权|压制|抗压|对位|单杀|前期|开局/;
const KEYWORD = /教学|教程|技巧|攻略|细节|玩法|克制|针对|思路|进阶|国服|打法|怎么玩|如何|对线|抢线|线权|压制|抗压|对位|单杀|前期|开局/;
const NOISE = /万象棋|自走棋|模拟战|王者荣耀世界|王者世界|AOV|传说对决|直播回放|录播|鬼畜|翻唱|手书|同人|cos|CG|皮肤(?!.*教学)|海报|语音|台词/i;
/** 每一路要看哪些方面，以及搜索时加的词 */
const WANT: Record<Lane, { aspects: LaneAspect[][]; query: string } | null> = {
  1: { aspects: [['lane', 'early']], query: '对抗路 对线' },
  2: null,
  3: { aspects: [['lane', 'early'], ['clear']], query: '中路 对线 抢线' },
  4: { aspects: [['lane', 'early', 'duo']], query: '射手 对线' },
  5: { aspects: [['clear'], ['duo', 'lane']], query: '辅助 开局 抢线 对线' },
};

class RiskControl extends Error {}

let cookie = '';
async function api(url: string): Promise<any> {
  let text: string;
  try {
    text = await fetchText(url, { minIntervalMs: 3000, retries: 0, init: { headers: { ...biliHeaders(cookie), 'User-Agent': UA } } });
  } catch (e) {
    throw new RiskControl(`请求被拒绝（${(e as Error).message.split(' ').slice(0, 2).join(' ')}）`);
  }
  const j = JSON.parse(text);
  if (j.code === -101) throw new RiskControl('Cookie 无效或已过期');
  if (j.code !== 0) throw new RiskControl(`接口返回 code=${j.code}（${j.message}）`);
  return j.data;
}

const strip = (s: string) => s.replace(/<[^>]+>/g, '');
const toSeconds = (d: string) => d.split(':').map(Number).reduce((s, x) => s * 60 + x, 0);
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

async function search(q: string, names: string[], otherNames: string[], found: Map<string, HeroVideo>) {
  const cutoff = Date.now() / 1000 - MAX_AGE_DAYS * 86400;
  const data = await api(`https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(q)}&order=totalrank&page=1`);
  for (const v of data?.result ?? []) {
    if (v.type !== 'video' || !v.bvid || found.has(v.bvid)) continue;
    const title = strip(v.title ?? '');
    const seconds = toSeconds(String(v.duration ?? '0'));
    if (seconds < 90 || seconds > 40 * 60 || v.pubdate < cutoff || (v.play ?? 0) < 2000) continue;
    // 先去掉标题里其他英雄的全名，避免“鲁班”匹配到“鲁班大师”的视频
    const own = otherNames.reduce((t, n) => t.split(n).join(' '), title);
    if (!names.some((n) => own.includes(n)) || !KEYWORD.test(title) || NOISE.test(title) || NOISE.test(v.author ?? '')) continue;
    const ageYears = (Date.now() / 1000 - v.pubdate) / (365 * 86400);
    const score = Math.log10(Math.max(v.play, 1)) - 1.2 * ageYears + (LANE_WORDS.test(title) ? 2 : 0);
    found.set(v.bvid, {
      bvid: v.bvid,
      aid: v.aid ?? v.id,
      title,
      uploader: v.author,
      mid: v.mid,
      play: v.play,
      pubdate: new Date(v.pubdate * 1000).toISOString().slice(0, 10),
      seconds,
      url: `https://www.bilibili.com/video/${v.bvid}`,
      query: q,
      score: Math.round(score * 100) / 100,
    });
  }
}

/** 返回：'ok' 已保存；'none' 没有可用字幕 */
async function fetchSubtitle(v: HeroVideo): Promise<'ok' | 'none'> {
  const out = resolve(DIR, 'subtitles', `${v.bvid}.txt`);
  const mark = resolve(DIR, 'subtitles', `${v.bvid}.none`);
  if (await exists(mark)) return 'none';
  const pages = await api(`https://api.bilibili.com/x/player/pagelist?bvid=${v.bvid}`);
  const cid = pages?.[0]?.cid;
  if (!cid) return 'none';
  const player = await api(`https://api.bilibili.com/x/player/wbi/v2?bvid=${v.bvid}&cid=${cid}`);
  const subs: { lan: string; subtitle_url: string }[] = player?.subtitle?.subtitles ?? [];
  const sub = subs.find((s) => s.lan === 'ai-zh') ?? subs.find((s) => s.lan?.startsWith('zh'));
  // 这个接口偶尔会返回别的视频的字幕；字幕地址里带有 aid+cid，对不上就不用
  const url = sub?.subtitle_url ?? '';
  if (!url || !url.includes(`${player.aid}${cid}`)) {
    await writeFileSafe(mark, url ? 'mismatch' : '');
    return 'none';
  }
  let body: { body?: { from: number; content: string }[] };
  try {
    body = JSON.parse(await fetchText(url.startsWith('//') ? `https:${url}` : url, { minIntervalMs: 3000, retries: 1 }));
  } catch (e) {
    // 字幕文件本身下载失败（网络问题）：跳过这个视频，不做“无字幕”标记，下次还能再试
    console.log(`  字幕下载失败，跳过 ${v.bvid}（${(e as Error).message.slice(0, 60)}）`);
    return 'none';
  }
  const lines: { from: number; content: string }[] = body?.body ?? [];
  if (lines.length < 15) {
    await writeFileSafe(mark, 'short');
    return 'none';
  }
  const text = lines.map((l) => `${fmt(l.from)} ${l.content}`).join('\n');
  await writeFileSafe(out, `# ${v.title}\n# UP主：${v.uploader}  发布：${v.pubdate}  播放：${v.play}  链接：${v.url}\n\n${text}\n`);
  return 'ok';
}

async function main() {
  cookie = loadEnv().BILI_COOKIE ?? '';
  if (!cookie) {
    console.log('未配置 BILI_COOKIE。先运行 python3 scripts/commentary/refresh-cookie.py');
    process.exit(2);
  }
  const bundle = await readJson<Bundle>(resolve(ROOT, 'public/data/bundle.json'));
  const { aliases } = await readJson<{ aliases: Record<string, string[]> }>(resolve(ROOT, 'data/curated/aliases.json'));
  const ix = buildLaneIndex(bundle.laning ?? null);
  const indexFile = resolve(DIR, 'lane-hero-videos.json');
  const index: Record<string, HeroVideo[] | boolean> = (await exists(indexFile)) ? await readJson(indexFile) : {};
  // 已经有字幕的视频（之前按英雄或按专题读过的）不再重复使用
  const have = new Set((await readdir(resolve(DIR, 'subtitles'))).filter((f) => f.endsWith('.txt')).map((f) => f.replace('.txt', '')));

  const known = (id: number, aspects: LaneAspect[], lane: Lane) =>
    aspects.some((a) => {
      const v = laneView(ix, id, a, lane);
      return v && v.level !== 'mixed';
    });
  const todo = bundle.heroes
    .filter((h) => !h.isLimited && (!ONLY || ONLY.includes(h.name)))
    .map((h) => ({ hero: h, lanes: LANES.filter((l) => h.lanes[l - 1] >= 0.3 && WANT[l] && WANT[l]!.aspects.some((as) => !known(h.id, as, l))) }))
    .filter((x) => x.lanes.length)
    .slice(0, MAX_HEROES);
  console.log(`缺对线说法的英雄 ${todo.length} 个`);

  let saved = 0;
  try {
    for (const { hero: h, lanes } of todo) {
      if (index[`${h.id}:done`]) continue;
      const base = h.name.replace(/[（(].*$/, '');
      const names = [...new Set([h.name, base, ...(aliases[h.name] ?? []).filter((a) => a.length >= 2)])];
      const otherNames = bundle.heroes.map((x) => x.name.replace(/[（(].*$/, '')).filter((n) => n !== base && n.length >= 2 && !base.includes(n));
      const found = new Map<string, HeroVideo>();
      for (const l of lanes) await search(`王者荣耀 ${base} ${WANT[l]!.query}`, names, otherNames, found);
      const cands = [...found.values()].filter((v) => !have.has(v.bvid)).sort((a, b) => b.score - a.score);
      const picked: HeroVideo[] = [];
      const perUploader = new Set<number>();
      let attempts = 0;
      for (const v of cands) {
        if (picked.length >= PER_HERO || attempts >= PER_HERO + 2) break;
        if (perUploader.has(v.mid)) continue;
        attempts++;
        if ((await fetchSubtitle(v)) === 'ok') {
          picked.push(v);
          perUploader.add(v.mid);
          have.add(v.bvid);
          saved++;
        }
      }
      index[h.id] = picked;
      index[`${h.id}:done`] = true;
      await writeJson(indexFile, index);
      console.log(`${h.name}：候选 ${cands.length}，新字幕 ${picked.length}${picked.length ? `（${picked.map((p) => `${p.uploader}《${p.title.slice(0, 18)}》`).join('、')}）` : ''}`);
    }
  } catch (e) {
    if (e instanceof RiskControl) console.log(`已停止：${e.message}。本次不再继续请求。`);
    else throw e;
  }
  await writeJson(indexFile, index);
  console.log(`本次新保存字幕 ${saved} 个；已处理 ${todo.filter((x) => index[`${x.hero.id}:done`]).length}/${todo.length} 个英雄`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
