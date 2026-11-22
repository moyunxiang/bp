// 王者营地英雄榜（路人局）：读取营地“分享页”使用的公开接口，不需要登录。
// 这个接口每次只返回热度最高的10个英雄；完整榜单和英雄详情里的克制数据需要在App里登录，这里不读取。
// 每个段位 × 每个位置各请求一次（共18次，间隔2秒）。原始响应只写入 data/raw/camp/（不进仓库），
// 整理后的结果写入 data/derived/camp.json。任何一次请求失败都保留旧文件、以非0状态退出。
// 用法：tsx scripts/fetch-camp.ts
import { resolve } from 'node:path';
import { z } from 'zod';
import { RAW, ROOT, exists, fetchText, readJson, writeFileSafe, writeJson } from './lib/http.ts';
import { LANES, type CampData, type CampEntry, type Lane, type OfficialHero } from '../src/types.ts';

const URL = 'https://kohcamp.qq.com/gametoolbox/hero/getsharepagedetailranklistbyid';
const PAGE = 'https://camp.qq.com/h5/webdist/hero-rank/index.html';
/** 营地的段位筛选（编号是接口里的 segment） */
const SEGMENTS = [
  { id: 3, name: '巅峰赛1350+' },
  { id: 4, name: '顶端排位' },
  { id: 1, name: '所有段位' },
];
/** 营地的位置编号 → 本站的分路编号（1对抗路 2打野 3中路 4发育路 5游走） */
const POSITION: Record<Lane, number> = { 1: 1, 2: 5, 3: 2, 4: 3, 5: 4 };

const Item = z.object({ heroId: z.number(), tRank: z.string(), winRate: z.number(), showRate: z.number(), banRate: z.number(), heroInfo: z.object({ heroName: z.string() }) });
type Item = z.infer<typeof Item>;

const Resp = z.object({
  returnCode: z.union([z.number(), z.string()]),
  returnMsg: z.string().optional(),
  data: z
    .object({
      updateTime: z.string().regex(/^\d{8}$/),
      list: z.array(Item),
    })
    .nullable()
    .optional(),
});

async function query(segment: number, position: number) {
  const text = await fetchText(URL, {
    minIntervalMs: 2000,
    retries: 1,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://camp.qq.com', Referer: 'https://camp.qq.com/' },
      body: JSON.stringify({ rankId: 0, position, segment, eId: null, h5Get: 1 }),
    },
  });
  const r = Resp.parse(JSON.parse(text));
  if (String(r.returnCode) !== '0' || !r.data) throw new Error(`接口返回 ${r.returnCode}（${r.returnMsg ?? ''}）`);
  if (r.data.list.length < 3) throw new Error(`只返回了 ${r.data.list.length} 个英雄`);
  return { text, data: r.data };
}

async function main() {
  const { heroes } = await readJson<{ heroes: OfficialHero[] }>(resolve(ROOT, 'data/derived/official/heroes.json'));
  const known = new Set(heroes.map((h) => h.id));
  const outFile = resolve(ROOT, 'data/derived/camp.json');
  const old = (await exists(outFile)) ? await readJson<CampData>(outFile) : null;

  const unknown = new Set<string>();
  let updateTime = '';
  const raw: { segment: number; position: number; text: string }[] = [];
  const toEntries = (list: Item[]): CampEntry[] =>
    list.flatMap((x) => {
      if (!known.has(x.heroId)) {
        unknown.add(x.heroInfo.heroName);
        return [];
      }
      return [{ id: x.heroId, tier: x.tRank, win: x.winRate, show: x.showRate, ban: x.banRate }];
    });

  const segments: CampData['segments'] = [];
  for (const seg of SEGMENTS) {
    const all = await query(seg.id, 0);
    raw.push({ segment: seg.id, position: 0, text: all.text });
    // 各请求的数据日期可能相差一天，取最早的
    updateTime = !updateTime || all.data.updateTime < updateTime ? all.data.updateTime : updateTime;
    const lanes = {} as Record<Lane, CampEntry[]>;
    for (const lane of LANES) {
      const r = await query(seg.id, POSITION[lane]);
      raw.push({ segment: seg.id, position: POSITION[lane], text: r.text });
      if (r.data.updateTime < updateTime) updateTime = r.data.updateTime;
      lanes[lane] = toEntries(r.data.list);
    }
    segments.push({ id: seg.id, name: seg.name, all: toEntries(all.data.list), lanes });
  }

  const date = `${updateTime.slice(0, 4)}-${updateTime.slice(4, 6)}-${updateTime.slice(6)}`;
  // 与上一份不同日期的数据比较，记下每个英雄上次的档位（上次不在前10则为 null）
  const base = old && old.updateTime !== date ? old : null;
  const prevOf = (segId: number, lane: Lane | 0, id: number): string | null | undefined => {
    if (base) {
      const s = base.segments.find((x) => x.id === segId);
      if (!s) return undefined;
      return (lane === 0 ? s.all : s.lanes[lane])?.find((e) => e.id === id)?.tier ?? null;
    }
    // 同一天重复抓取：沿用已有的比较结果
    const s = old?.segments.find((x) => x.id === segId);
    return (lane === 0 ? s?.all : s?.lanes[lane])?.find((e) => e.id === id)?.prev;
  };
  for (const s of segments) {
    for (const e of s.all) e.prev = prevOf(s.id, 0, e.id);
    for (const lane of LANES) for (const e of s.lanes[lane]) e.prev = prevOf(s.id, lane, e.id);
  }

  const out: CampData = {
    source: '王者营地英雄榜（公开分享页）',
    url: PAGE,
    fetchedAt: new Date().toISOString(),
    updateTime: date,
    prevUpdateTime: base ? base.updateTime : (old?.prevUpdateTime ?? null),
    limit: 10,
    segments,
  };
  for (const r of raw) await writeFileSafe(resolve(RAW, 'camp', updateTime, `${r.segment}-${r.position}.json`), r.text);
  await writeJson(outFile, out);
  const n = new Set(segments.flatMap((s) => LANES.flatMap((l) => s.lanes[l].map((e) => e.id)))).size;
  console.log(`营地英雄榜：数据日期 ${date}，${segments.length} 个段位 × 5 个位置，共 ${n} 个不同英雄${base ? `；与 ${base.updateTime} 的数据做了对比` : ''}`);
  if (unknown.size) console.log(`本站英雄表里没有的英雄（已跳过）：${[...unknown].join('、')}`);
}

main().catch((e) => {
  console.error(`营地英雄榜读取失败：${(e as Error).message}。已保留原有数据。`);
  process.exit(1);
});
