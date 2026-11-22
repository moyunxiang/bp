// 发现B站上与BP、克制、阵容相关的解说视频。只保存元数据（标题、UP主、链接、播放量等）。
// 结果写入 data/raw/commentary/candidates.json（不进仓库）。遇到风控（非0返回码或HTTP 412）立即停止，不重试、不绕过。
// 实测：本机直连时未登录的搜索请求会被412拦截，所以需要在 .env.local 里提供自己的 BILI_COOKIE（见 .env.example）。
// 用法：tsx scripts/commentary/discover.ts [--days=180] [--pages=2] [--min-play=20000]
import { resolve } from 'node:path';
import { RAW, fetchText, writeJson } from '../lib/http.ts';
import { biliHeaders, loadEnv } from '../lib/env.ts';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const DAYS = Number(arg('days') ?? 180);
const PAGES = Number(arg('pages') ?? 2);
const MIN_PLAY = Number(arg('min-play') ?? 20000);
const MIN_SECONDS = 180;

const QUERIES = ['王者荣耀 BP思路', '王者荣耀 英雄克制', '王者荣耀 克制关系 讲解', '王者荣耀 阵容搭配 思路', 'KPL BP解析', '王者荣耀 巅峰赛 BP 禁选', '王者荣耀 版本强势 阵容 体系'];

export interface Candidate {
  bvid: string;
  title: string;
  uploader: string;
  mid: number;
  play: number;
  pubdate: string;
  seconds: number;
  url: string;
  description: string;
  queries: string[];
}

const strip = (s: string) => s.replace(/<[^>]+>/g, '');
const toSeconds = (d: string) => d.split(':').map(Number).reduce((s, x) => s * 60 + x, 0);

async function main() {
  const cookie = loadEnv().BILI_COOKIE;
  if (!cookie || cookie.includes('在这里粘贴')) console.log('未配置 BILI_COOKIE，将以未登录状态尝试（很可能被412拦截）。');
  const cutoff = Date.now() / 1000 - DAYS * 86400;
  const found = new Map<string, Candidate>();
  let requests = 0;
  outer: for (const q of QUERIES) {
    for (const order of ['click', 'pubdate']) {
      for (let page = 1; page <= PAGES; page++) {
        const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(q)}&order=${order}&page=${page}`;
        let j: any;
        try {
          j = JSON.parse(await fetchText(url, { minIntervalMs: 3000, retries: 0, init: { headers: biliHeaders(cookie && !cookie.includes('在这里粘贴') ? cookie : undefined) } }));
        } catch (e) {
          console.log(`请求失败，停止：${(e as Error).message.replace(/keyword=[^ ]*/, 'keyword=…')}`);
          break outer;
        }
        requests++;
        if (j.code !== 0) {
          console.log(`接口返回 code=${j.code}（${j.message}），可能触发风控，停止。`);
          break outer;
        }
        for (const v of j.data?.result ?? []) {
          if (v.type !== 'video' || !v.bvid) continue;
          const seconds = toSeconds(String(v.duration ?? '0'));
          if (v.pubdate < cutoff || seconds < MIN_SECONDS || (v.play ?? 0) < MIN_PLAY) continue;
          const title = strip(v.title ?? '');
          if (!/王者|KPL|巅峰赛/.test(title + (v.tag ?? '') + (v.typename ?? ''))) continue;
          const c: Candidate = found.get(v.bvid) ?? {
            bvid: v.bvid,
            title,
            uploader: v.author,
            mid: v.mid,
            play: v.play,
            pubdate: new Date(v.pubdate * 1000).toISOString().slice(0, 10),
            seconds,
            url: `https://www.bilibili.com/video/${v.bvid}`,
            description: strip(v.description ?? '').slice(0, 200),
            queries: [],
          };
          if (!c.queries.includes(q)) c.queries.push(q);
          found.set(v.bvid, c);
        }
      }
    }
  }
  const list = [...found.values()].sort((a, b) => b.queries.length - a.queries.length || b.play - a.play);
  await writeJson(resolve(RAW, 'commentary/candidates.json'), { fetchedAt: new Date().toISOString(), days: DAYS, minPlay: MIN_PLAY, requests, candidates: list });
  console.log(`请求 ${requests} 次，候选视频 ${list.length} 个（近${DAYS}天、时长≥${MIN_SECONDS}秒、播放≥${MIN_PLAY}）`);
  for (const c of list.slice(0, 12)) console.log(`  ${c.pubdate} ${String(c.play).padStart(8)} ${c.uploader}《${c.title.slice(0, 40)}》`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
