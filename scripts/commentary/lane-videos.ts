// 发现B站上专门讲“对线强度、抢线、射辅组合”的视频并读取AI字幕，供提炼对线档案使用。
// 原始字幕只保存在 data/raw/commentary/subtitles/（不进仓库、不公开）；视频清单写入 data/raw/commentary/lane-videos.json。
// 需要 .env.local 里的 BILI_COOKIE。低频访问：每次请求间隔≥3秒；遇到风控（HTTP 412、返回码非0）立即停止，不重试、不绕过；可断点续跑。
// 用法：tsx scripts/commentary/lane-videos.ts [--max=60] [--days=400] [--min-play=3000] [--pages=2]
// 换了搜索词或页数后，先把 data/raw/commentary/lane-candidates.json 改名，再运行（已有的字幕不会重复读取）。
import { resolve } from "node:path";
import {
  RAW,
  exists,
  fetchText,
  readJson,
  writeFileSafe,
  writeJson,
} from "../lib/http.ts";
import { biliHeaders, loadEnv } from "../lib/env.ts";

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const MAX = Number(arg("max") ?? 60);
const DAYS = Number(arg("days") ?? 400);
const MIN_PLAY = Number(arg("min-play") ?? 3000);
const PAGES = Number(arg("pages") ?? 2);
const DIR = resolve(RAW, "commentary");
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** 每个主题的搜索词；topic 只用于统计各主题找到了多少 */
const QUERIES: { topic: string; q: string }[] = [
  { topic: "对抗路", q: "王者荣耀 对抗路 对线强度" },
  { topic: "对抗路", q: "王者荣耀 对抗路 对线 克制 讲解" },
  { topic: "对抗路", q: "王者荣耀 边路 前期强势 对线" },
  { topic: "中路", q: "王者荣耀 中路 抢线" },
  { topic: "中路", q: "王者荣耀 法师 清线速度" },
  { topic: "中路", q: "王者荣耀 中路 对线 线权" },
  { topic: "发育路", q: "王者荣耀 射手 对线强度" },
  { topic: "发育路", q: "王者荣耀 发育路 对线 压制" },
  { topic: "发育路", q: "王者荣耀 射手 前期 强势 对线" },
  { topic: "射辅", q: "王者荣耀 射辅组合" },
  { topic: "射辅", q: "王者荣耀 射手 辅助 搭配 对线" },
  { topic: "辅助", q: "王者荣耀 辅助 抢线" },
  { topic: "辅助", q: "王者荣耀 中辅 抢线 开局" },
  { topic: "辅助", q: "王者荣耀 辅助 开局 思路 线权" },
  // 第二轮：按英雄分档讲强弱的视频（排行、梯度、克制关系）
  { topic: "对抗路", q: "王者荣耀 对抗路 对线强度 排行" },
  { topic: "对抗路", q: "王者荣耀 对抗路 英雄 对线 梯度" },
  { topic: "对抗路", q: "王者荣耀 对抗路 对线 克制关系" },
  { topic: "对抗路", q: "王者荣耀 边路 对线 谁最强" },
  { topic: "中路", q: "王者荣耀 中路 抢线 排行" },
  { topic: "中路", q: "王者荣耀 法师 抢线能力 排名" },
  { topic: "中路", q: "王者荣耀 中单 清线 最快" },
  { topic: "中路", q: "王者荣耀 中路 英雄 对线 克制关系" },
  { topic: "发育路", q: "王者荣耀 射手 对线强度 排行" },
  { topic: "发育路", q: "王者荣耀 射手 对线 梯度" },
  { topic: "发育路", q: "王者荣耀 发育路 英雄 对线 克制关系" },
  { topic: "射辅", q: "王者荣耀 射辅 对线 组合 排行" },
  { topic: "射辅", q: "王者荣耀 下路 最强 组合" },
  { topic: "辅助", q: "王者荣耀 辅助 抢线能力 排行" },
  { topic: "辅助", q: "王者荣耀 辅助 对线强度" },
  { topic: "辅助", q: "王者荣耀 中辅联动 抢线" },
];
const KEYWORD =
  /对线|抢线|清线|线权|射辅|下路组合|强势期|前期强|压制|开局|中辅/;
const NOISE =
  /万象棋|自走棋|模拟战|王者荣耀世界|王者世界|AOV|传说对决|直播回放|录播|鬼畜|翻唱|手书|同人|cos|CG|海报|语音|台词|英雄联盟|LOL|金铲铲|云顶/i;

export interface LaneVideo {
  bvid: string;
  aid: number;
  title: string;
  uploader: string;
  mid: number;
  play: number;
  pubdate: string;
  seconds: number;
  url: string;
  topics: string[];
  score: number;
}

class RiskControl extends Error {}

let cookie = "";
async function api(url: string): Promise<any> {
  let text: string;
  try {
    text = await fetchText(url, {
      minIntervalMs: 3000,
      retries: 0,
      init: { headers: { ...biliHeaders(cookie), "User-Agent": UA } },
    });
  } catch (e) {
    throw new RiskControl(
      `请求被拒绝（${(e as Error).message.split(" ").slice(0, 2).join(" ")}）`,
    );
  }
  const j = JSON.parse(text);
  if (j.code === -101) throw new RiskControl("Cookie 无效或已过期");
  if (j.code !== 0)
    throw new RiskControl(`接口返回 code=${j.code}（${j.message}）`);
  return j.data;
}

const strip = (s: string) => s.replace(/<[^>]+>/g, "");
const toSeconds = (d: string) =>
  d
    .split(":")
    .map(Number)
    .reduce((s, x) => s * 60 + x, 0);
const fmt = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

async function discover(): Promise<LaneVideo[]> {
  const file = resolve(DIR, "lane-candidates.json");
  if (await exists(file))
    return (await readJson<{ videos: LaneVideo[] }>(file)).videos;
  const cutoff = Date.now() / 1000 - DAYS * 86400;
  const found = new Map<string, LaneVideo>();
  for (const { topic, q } of QUERIES)
    for (let page = 1; page <= PAGES; page++) {
      const data = await api(
        `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(q)}&order=totalrank&page=${page}`,
      );
      for (const v of data?.result ?? []) {
        if (v.type !== "video" || !v.bvid) continue;
        const title = strip(v.title ?? "");
        const seconds = toSeconds(String(v.duration ?? "0"));
        if (
          seconds < 120 ||
          seconds > 40 * 60 ||
          v.pubdate < cutoff ||
          (v.play ?? 0) < MIN_PLAY
        )
          continue;
        if (
          !KEYWORD.test(title) ||
          NOISE.test(title) ||
          NOISE.test(v.author ?? "")
        )
          continue;
        if (
          !/王者/.test(
            title + (v.tag ?? "") + (v.typename ?? "") + (v.description ?? ""),
          )
        )
          continue;
        const prev = found.get(v.bvid);
        if (prev) {
          if (!prev.topics.includes(topic)) prev.topics.push(topic);
          continue;
        }
        const ageYears = (Date.now() / 1000 - v.pubdate) / (365 * 86400);
        // 排序：播放量为主，越新越好（对线强弱随版本变化，新视频权重更高）
        const score = Math.log10(Math.max(v.play, 1)) - 1.5 * ageYears;
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
          topics: [topic],
          score: Math.round(score * 100) / 100,
        });
      }
    }
  const videos = [...found.values()].sort((a, b) => b.score - a.score);
  await writeJson(file, {
    fetchedAt: new Date().toISOString(),
    days: DAYS,
    minPlay: MIN_PLAY,
    videos,
  });
  return videos;
}

/** 返回：'ok' 已保存；'none' 没有可用字幕 */
async function fetchSubtitle(v: LaneVideo): Promise<"ok" | "none"> {
  const out = resolve(DIR, "subtitles", `${v.bvid}.txt`);
  const mark = resolve(DIR, "subtitles", `${v.bvid}.none`);
  if (await exists(out)) return "ok";
  if (await exists(mark)) return "none";
  const pages = await api(
    `https://api.bilibili.com/x/player/pagelist?bvid=${v.bvid}`,
  );
  const cid = pages?.[0]?.cid;
  if (!cid) return "none";
  const player = await api(
    `https://api.bilibili.com/x/player/wbi/v2?bvid=${v.bvid}&cid=${cid}`,
  );
  const subs: { lan: string; subtitle_url: string }[] =
    player?.subtitle?.subtitles ?? [];
  const sub =
    subs.find((s) => s.lan === "ai-zh") ??
    subs.find((s) => s.lan?.startsWith("zh"));
  // 这个接口偶尔会返回别的视频的字幕；字幕地址里带有 aid+cid，对不上就不用
  const url = sub?.subtitle_url ?? "";
  if (!url || !url.includes(`${player.aid}${cid}`)) {
    await writeFileSafe(mark, url ? "mismatch" : "");
    return "none";
  }
  const body = JSON.parse(
    await fetchText(url.startsWith("//") ? `https:${url}` : url, {
      minIntervalMs: 3000,
      retries: 1,
    }),
  );
  const lines: { from: number; content: string }[] = body?.body ?? [];
  if (lines.length < 15) {
    await writeFileSafe(mark, "short");
    return "none";
  }
  const text = lines.map((l) => `${fmt(l.from)} ${l.content}`).join("\n");
  await writeFileSafe(
    out,
    `# ${v.title}\n# UP主：${v.uploader}  发布：${v.pubdate}  播放：${v.play}  链接：${v.url}\n\n${text}\n`,
  );
  return "ok";
}

async function main() {
  cookie = loadEnv().BILI_COOKIE ?? "";
  if (!cookie) {
    console.log(
      "未配置 BILI_COOKIE。先运行 python3 scripts/commentary/refresh-cookie.py",
    );
    process.exit(2);
  }
  const indexFile = resolve(DIR, "lane-videos.json");
  const picked: LaneVideo[] = (await exists(indexFile))
    ? (await readJson<{ videos: LaneVideo[] }>(indexFile)).videos
    : [];
  let saved = 0;
  let cands: LaneVideo[] = [];
  try {
    cands = await discover();
    const perUploader = new Map<number, number>();
    for (const p of picked)
      perUploader.set(p.mid, (perUploader.get(p.mid) ?? 0) + 1);
    for (const v of cands) {
      if (picked.length >= MAX) break;
      // 同一个UP主最多3个视频，避免一个人的看法占比过大
      if (
        picked.some((p) => p.bvid === v.bvid) ||
        (perUploader.get(v.mid) ?? 0) >= 3
      )
        continue;
      if ((await fetchSubtitle(v)) === "ok") {
        picked.push(v);
        perUploader.set(v.mid, (perUploader.get(v.mid) ?? 0) + 1);
        saved++;
        await writeJson(indexFile, { videos: picked });
        console.log(
          `  字幕已保存：[${v.topics.join("/")}] ${v.pubdate} ${v.uploader}《${v.title.slice(0, 36)}》`,
        );
      }
    }
  } catch (e) {
    if (e instanceof RiskControl)
      console.log(`已停止：${e.message}。本次不再继续请求。`);
    else throw e;
  }
  await writeJson(indexFile, { videos: picked });
  const byTopic = new Map<string, number>();
  for (const p of picked)
    for (const t of p.topics) byTopic.set(t, (byTopic.get(t) ?? 0) + 1);
  console.log(
    `候选 ${cands.length} 个；本次新保存字幕 ${saved} 个；共 ${picked.length} 个（${[...byTopic].map(([t, n]) => `${t}${n}`).join("、")}）`,
  );
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
