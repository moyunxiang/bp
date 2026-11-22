// 按英雄发现B站教学视频并读取AI字幕，供提炼“连招、细节、克制关系”使用。
// 原始字幕只保存在 data/raw/commentary/（不进仓库、不公开）。
// 需要 .env.local 里的 BILI_COOKIE（python3 scripts/commentary/refresh-cookie.py 可从本机 Chrome 读出）。
// 低频访问：全局每次请求间隔≥3秒；遇到风控（HTTP 412、返回码非0）立即停止，不重试、不绕过；可断点续跑。
// 用法：tsx scripts/commentary/hero-guides.ts [--heroes=镜,王昭君 [--redo]] [--per-hero=3] [--max-heroes=200]
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { RAW, ROOT, exists, fetchText, readJson, writeFileSafe, writeJson } from '../lib/http.ts';
import { biliHeaders, loadEnv } from '../lib/env.ts';
import type { OfficialHero } from '../../src/types.ts';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const PER_HERO = Number(arg('per-hero') ?? 3);
const MAX_HEROES = Number(arg('max-heroes') ?? 200);
const ONLY = arg('heroes')?.split(',');
/** --redo：对 --heroes 指定的英雄丢掉旧的候选和已选列表，重新发现 */
const REDO = process.argv.includes('--redo');
const DIR = resolve(RAW, 'commentary');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MAX_AGE_DAYS = 730;
const KEYWORD = /教学|教程|连招|技巧|攻略|细节|玩法|克制|针对|思路|进阶|入门|国服|上手|机制|打法|怎么玩|如何/;
// 用户指定的优先来源：这些UP主的视频排在最前（mid → 名字）
const PREFERRED = new Map<number, string>([[328090313, '公瑾干货教学']]);
const NOISE = /万象棋|自走棋|模拟战|王者荣耀世界|直播回放|录播|鬼畜|翻唱|手书|同人|cos|CG|皮肤(?!.*教学)|海报|语音|台词/i;

export interface HeroVideo {
  bvid: string;
  aid: number;
  title: string;
  uploader: string;
  mid: number;
  play: number;
  pubdate: string;
  seconds: number;
  url: string;
  query: string;
  score: number;
}

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

async function discover(hero: OfficialHero, names: string[], otherNames: string[]): Promise<HeroVideo[]> {
  const file = resolve(DIR, 'hero-candidates', `${hero.id}.json`);
  if (await exists(file)) return (await readJson<{ videos: HeroVideo[] }>(file)).videos;
  const cutoff = Date.now() / 1000 - MAX_AGE_DAYS * 86400;
  const found = new Map<string, HeroVideo>();
  for (const q of [`公瑾干货教学 ${hero.name}`, `王者荣耀 ${hero.name} 教学`, `王者荣耀 ${hero.name} 连招 细节`, `王者荣耀 ${hero.name} 克制 怎么针对`]) {
    const data = await api(`https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(q)}&order=totalrank&page=1`);
    for (const v of data?.result ?? []) {
      if (v.type !== 'video' || !v.bvid || found.has(v.bvid)) continue;
      const title = strip(v.title ?? '');
      const seconds = toSeconds(String(v.duration ?? '0'));
      if (seconds < 90 || seconds > 45 * 60) continue;
      // 优先来源放宽发布时间和播放量限制
      if (!PREFERRED.has(v.mid) && (v.pubdate < cutoff || (v.play ?? 0) < 3000)) continue;
      // 先去掉标题里其他英雄的全名，避免“鲁班”匹配到“鲁班大师”的视频
      const own = otherNames.reduce((t, n) => t.split(n).join(' '), title);
      if (!names.some((n) => own.includes(n)) || !KEYWORD.test(title) || NOISE.test(title)) continue;
      const ageYears = (Date.now() / 1000 - v.pubdate) / (365 * 86400);
      // 排序：播放量为主，越新越好，时长适中（3–25分钟）加分
      const score = Math.log10(Math.max(v.play, 1)) - 0.8 * ageYears + (seconds >= 180 && seconds <= 25 * 60 ? 0.4 : 0) + (PREFERRED.has(v.mid) ? 3 : 0);
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
  const videos = [...found.values()].sort((a, b) => b.score - a.score);
  await writeJson(file, { heroId: hero.id, name: hero.name, fetchedAt: new Date().toISOString(), videos });
  return videos;
}

/** 返回：'ok' 已保存；'none' 没有可用字幕 */
async function fetchSubtitle(v: HeroVideo): Promise<'ok' | 'none'> {
  const out = resolve(DIR, 'subtitles', `${v.bvid}.txt`);
  const mark = resolve(DIR, 'subtitles', `${v.bvid}.none`);
  if (await exists(out)) return 'ok';
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
  const body = JSON.parse(await fetchText(url.startsWith('//') ? `https:${url}` : url, { minIntervalMs: 3000, retries: 1 }));
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
  const { heroes } = await readJson<{ heroes: OfficialHero[] }>(resolve(ROOT, 'data/derived/official/heroes.json'));
  const { aliases } = await readJson<{ aliases: Record<string, string[]> }>(resolve(ROOT, 'data/curated/aliases.json'));
  const indexFile = resolve(DIR, 'hero-videos.json');
  const index: Record<string, HeroVideo[]> = (await exists(indexFile)) ? await readJson(indexFile) : {};
  const todo = heroes.filter((h) => (ONLY ? ONLY.includes(h.name) : true)).slice(0, MAX_HEROES);
  let saved = 0;
  try {
    for (const h of todo) {
      if (REDO && ONLY) {
        delete index[h.id];
        delete (index as any)[`${h.id}:done`];
        await rm(resolve(DIR, 'hero-candidates', `${h.id}.json`), { force: true });
      }
      if ((index[h.id]?.length ?? 0) >= PER_HERO || index[`${h.id}:done`]) continue;
      // 标题里出现的名字：正式名，去掉括号的名字，较长的外号
      const base = h.name.replace(/[（(].*$/, '');
      const names = [...new Set([h.name, base, ...(aliases[h.name] ?? []).filter((a) => a.length >= 2)])];
      const otherNames = heroes.map((x) => x.name.replace(/[（(].*$/, '')).filter((n) => n !== base && n.length >= 2 && !base.includes(n));
      const cands = await discover(h, names, otherNames);
      const picked: HeroVideo[] = index[h.id] ?? [];
      const perUploader = new Map<number, number>();
      let attempts = 0;
      for (const v of cands) {
        if (picked.length >= PER_HERO || attempts >= PER_HERO + 4) break;
        if (picked.some((p) => p.bvid === v.bvid) || (perUploader.get(v.mid) ?? 0) >= 1) continue;
        attempts++;
        if ((await fetchSubtitle(v)) === 'ok') {
          picked.push(v);
          perUploader.set(v.mid, (perUploader.get(v.mid) ?? 0) + 1);
          saved++;
        }
      }
      index[h.id] = picked;
      (index as any)[`${h.id}:done`] = true;
      await writeJson(indexFile, index);
      console.log(`${h.name}：候选 ${cands.length}，有字幕 ${picked.length}（${picked.map((p) => p.uploader).join('、')}）`);
    }
  } catch (e) {
    if (e instanceof RiskControl) console.log(`已停止：${e.message}。本次不再继续请求。`);
    else throw e;
  }
  await writeJson(indexFile, index);
  const done = heroes.filter((h) => (index as any)[`${h.id}:done`]).length;
  const withVideo = heroes.filter((h) => (index[h.id]?.length ?? 0) > 0).length;
  console.log(`本次新保存字幕 ${saved} 个；已处理英雄 ${done}/${heroes.length}，其中有字幕的 ${withVideo} 个`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
