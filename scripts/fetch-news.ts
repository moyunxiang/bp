// 抓取正式服版本更新/平衡性调整公告。
// 原始正文只写入 data/raw/news/（不进仓库）；data/derived/patches.json 只保留标题、日期、链接、涉及英雄和逐条改动。
// 用法：tsx scripts/fetch-news.ts [--days=200] [--refresh]
import { resolve } from 'node:path';
import * as cheerio from 'cheerio';
import { RAW, ROOT, fetchCached, fetchText, readJson, writeJson } from './lib/http.ts';
import type { OfficialHero, PatchNote } from '../src/types.ts';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const days = Number(arg('days') ?? 200);
const refresh = process.argv.includes('--refresh');
const OUT = resolve(RAW, 'news');
const LIST = (start: number) =>
  `https://apps.game.qq.com/cmc/cross?serviceId=18&filter=channel&sortby=sIdxTime&source=web_pc&limit=50&logic=or&typeids=1,2&chanid=1762&start=${start}`;
const BODY = (id: number | string) => `https://apps.game.qq.com/wmp/v3.1/public/searchNews.php?p0=18&source=web_pc&id=${id}`;

interface ListItem {
  iNewsId: number;
  sTitle: string;
  sIdxTime: string;
  sTagInfo: string;
}

const isRelevant = (it: ListItem) =>
  it.sTagInfo.includes('6181|正式服') && /版本更新公告|英雄平衡性调整|赛季/.test(it.sTitle) && !/处罚|体验服/.test(it.sTitle);

function bodyToLines(html: string): string[] {
  const text = cheerio
    .load(`<div>${html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|li|tr)>/gi, '\n')}</div>`)('div')
    .text();
  return text
    .split('\n')
    .map((l) => l.replace(/ /g, ' ').trim())
    .filter(Boolean);
}

/** 从正文中提取“英雄调整”段落：英雄名独占一行，其后是该英雄的改动行。 */
function parseHeroChanges(lines: string[], heroByName: Map<string, OfficialHero>) {
  const out: { id: number; name: string; lines: string[] }[] = [];
  const start = lines.findIndex((l) => /^(英雄(平衡性)?调整|英雄平衡)/.test(l) && l.length <= 12);
  if (start < 0) return out;
  let cur: { id: number; name: string; lines: string[] } | null = null;
  for (const l of lines.slice(start + 1)) {
    const hero = heroByName.get(l.replace(/[:：]$/, ''));
    if (hero) {
      cur = { id: hero.id, name: hero.name, lines: [] };
      out.push(cur);
      continue;
    }
    const looksLikeChange = /[:：→]|新增|调整|优化|修复|移除|提升|降低/.test(l);
    if (!cur) {
      if (!looksLikeChange) continue; // 段落开头的说明文字
      break;
    }
    // 没有改动特征的短行视为下一个板块的标题，结束
    if (!looksLikeChange && l.length <= 14) break;
    if (cur.lines.length < 20) cur.lines.push(l);
  }
  return out.filter((h) => h.lines.length);
}

/** 标题里写明的方向，例如“英雄平衡性调整 | 澜增强”。 */
function titleDirections(title: string, heroByName: Map<string, OfficialHero>) {
  const out = new Map<number, 'buff' | 'nerf'>();
  for (const seg of title.split(/[|｜、，,\s]+/)) {
    const m = /^(.+?)(增强|削弱)$/.exec(seg.trim());
    if (!m) continue;
    const h = heroByName.get(m[1]);
    if (h) out.set(h.id, m[2] === '增强' ? 'buff' : 'nerf');
  }
  return out;
}

async function main() {
  const { heroes } = await readJson<{ heroes: OfficialHero[] }>(resolve(ROOT, 'data/derived/official/heroes.json'));
  const heroByName = new Map(heroes.map((h) => [h.name, h]));
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

  const picked: ListItem[] = [];
  for (let start = 0; start < 2000; start += 50) {
    const j = JSON.parse(await fetchText(LIST(start)));
    const items: ListItem[] = j?.data?.items ?? [];
    if (!items.length) break;
    picked.push(...items.filter(isRelevant).filter((it) => it.sIdxTime.slice(0, 10) >= cutoff));
    if (items[items.length - 1].sIdxTime.slice(0, 10) < cutoff) break;
  }
  console.log(`${cutoff} 以来正式服相关公告 ${picked.length} 条`);

  const patches: PatchNote[] = [];
  let season: { name: string; date: string; id: number } | null = null;
  for (const it of picked) {
    const { text } = await fetchCached(BODY(it.iNewsId), resolve(OUT, `${it.iNewsId}.js`), { refresh });
    let content = '';
    try {
      content = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))?.msg?.sContent ?? '';
    } catch {
      console.log(`  正文解析失败 ${it.iNewsId} ${it.sTitle}`);
    }
    const lines = bodyToLines(content);
    const dirs = titleDirections(it.sTitle, heroByName);
    const changes = parseHeroChanges(lines, heroByName);
    // 标题点名但正文未解析到的英雄也要记录
    for (const [id] of dirs) if (!changes.some((c) => c.id === id)) changes.push({ id, name: heroes.find((h) => h.id === id)!.name, lines: [] });

    const sm = /(S\d+)赛季/.exec(it.sTitle) ?? /(S\d+)赛季/.exec(lines.slice(0, 30).join(' '));
    if (sm && /赛季/.test(it.sTitle) && (!season || it.sIdxTime > season.date)) {
      const nm = /[「“"《]([^」”"》]{2,12})[」”"》]/.exec(it.sTitle);
      season = { name: nm ? `${sm[1]}「${nm[1]}」` : sm[1], date: it.sIdxTime.slice(0, 10), id: it.iNewsId };
    }

    patches.push({
      id: it.iNewsId,
      title: it.sTitle,
      date: it.sIdxTime.slice(0, 10),
      url: `https://pvp.qq.com/web201706/newsdetail.shtml?tid=${it.iNewsId}`,
      heroes: changes.map((c) => ({ id: c.id, name: c.name, direction: dirs.get(c.id) ?? 'adjust', lines: c.lines })),
    });
  }

  patches.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  await writeJson(resolve(ROOT, 'data/derived/patches.json'), {
    fetchedAt: new Date().toISOString(),
    windowDays: days,
    season,
    latestPatchDate: patches.find((p) => /版本更新公告/.test(p.title))?.date ?? null,
    patches,
  });
  const withHeroes = patches.filter((p) => p.heroes.length);
  console.log(`公告 ${patches.length} 条，其中含英雄改动 ${withHeroes.length} 条；赛季：${season?.name ?? '未识别'}`);
  for (const p of withHeroes.slice(0, 12)) console.log(`  ${p.date} ${p.title} → ${p.heroes.map((h) => `${h.name}(${h.direction},${h.lines.length}行)`).join(' ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
