// 读取候选解说视频的AI字幕，保存到 data/raw/commentary/subtitles/（不进仓库，不公开）。
// 需要在 .env.local 里提供自己的 BILI_COOKIE。低频访问：每次请求间隔≥3秒，单次运行默认最多20个视频；
// 遇到风控（HTTP 412、返回码非0）立即停止，不重试、不绕过。Cookie 只放进请求头，不写入任何文件或输出。
// 用法：tsx scripts/commentary/fetch-subtitles.ts [--max=20]
import { resolve } from 'node:path';
import { RAW, exists, fetchText, readJson, writeFileSafe, writeJson } from '../lib/http.ts';
import { biliHeaders, loadEnv } from '../lib/env.ts';
import type { Candidate } from './discover.ts';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const MAX = Number(arg('max') ?? 20);
const DIR = resolve(RAW, 'commentary');

class RiskControl extends Error {}

async function api(url: string, cookie: string): Promise<any> {
  let text: string;
  try {
    text = await fetchText(url, { minIntervalMs: 3000, retries: 0, init: { headers: biliHeaders(cookie) } });
  } catch (e) {
    throw new RiskControl(`请求被拒绝（${(e as Error).message.split(' ').slice(0, 2).join(' ')}）`);
  }
  const j = JSON.parse(text);
  if (j.code === -101) throw new RiskControl('Cookie 无效或已过期，请重新获取 SESSDATA');
  if (j.code !== 0) throw new RiskControl(`接口返回 code=${j.code}（${j.message}）`);
  return j.data;
}

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

async function main() {
  const cookie = loadEnv().BILI_COOKIE;
  if (!cookie || cookie.includes('在这里粘贴')) {
    console.log('未配置 BILI_COOKIE。请按 .env.example 的说明创建 .env.local 后再运行。');
    process.exit(2);
  }
  const candFile = resolve(DIR, 'candidates.json');
  if (!(await exists(candFile))) {
    console.log('没有候选视频清单，请先运行 tsx scripts/commentary/discover.ts');
    process.exit(2);
  }
  const { candidates } = await readJson<{ candidates: Candidate[] }>(candFile);
  let done = 0;
  let none = 0;
  try {
    for (const c of candidates) {
      if (done >= MAX) break;
      const out = resolve(DIR, 'subtitles', `${c.bvid}.txt`);
      const mark = resolve(DIR, 'subtitles', `${c.bvid}.none`);
      if ((await exists(out)) || (await exists(mark))) continue;

      const pages = await api(`https://api.bilibili.com/x/player/pagelist?bvid=${c.bvid}`, cookie);
      const cid = pages?.[0]?.cid;
      if (!cid) continue;
      const player = await api(`https://api.bilibili.com/x/player/v2?bvid=${c.bvid}&cid=${cid}`, cookie);
      const subs: { lan: string; subtitle_url: string }[] = player?.subtitle?.subtitles ?? [];
      const sub = subs.find((s) => s.lan?.startsWith('ai-zh')) ?? subs.find((s) => s.lan?.startsWith('zh')) ?? subs[0];
      if (!sub?.subtitle_url) {
        // 记下“没有字幕”，下次不再请求
        await writeFileSafe(mark, '');
        none++;
        continue;
      }
      const body = JSON.parse(await fetchText(sub.subtitle_url.startsWith('//') ? `https:${sub.subtitle_url}` : sub.subtitle_url, { minIntervalMs: 3000, retries: 1 }));
      const lines: { from: number; content: string }[] = body?.body ?? [];
      // 文字稿：每行“分:秒 内容”，供提炼时引用时间点
      const text = lines.map((l) => `${fmt(l.from)} ${l.content}`).join('\n');
      await writeFileSafe(out, `# ${c.title}\n# UP主：${c.uploader}  发布：${c.pubdate}  链接：${c.url}\n\n${text}\n`);
      done++;
      console.log(`  字幕已保存：${c.uploader}《${c.title.slice(0, 30)}》（${lines.length}行）`);
    }
  } catch (e) {
    if (e instanceof RiskControl) console.log(`已停止：${e.message}。本次不再继续请求。`);
    else throw e;
  }
  await writeJson(resolve(DIR, 'subtitles', '_last-run.json'), { at: new Date().toISOString(), saved: done, withoutSubtitle: none });
  console.log(`本次保存字幕 ${done} 个，没有字幕 ${none} 个。下一步：按 docs/curation/commentary.md 提炼条目。`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
