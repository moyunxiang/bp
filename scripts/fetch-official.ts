// 抓取官方英雄资料原始数据到 data/raw/official/。
// 用法：tsx scripts/fetch-official.ts [--refresh]
import { resolve } from 'node:path';
import { RAW, fetchCached, readJson, writeJson, hktNow } from './lib/http.ts';

const refresh = process.argv.includes('--refresh');
const OUT = resolve(RAW, 'official');
const BASE = 'https://pvp.qq.com/web201605';

interface RawHero {
  ename: number;
  cname: string;
  id_name: string;
}

async function main() {
  const failures: string[] = [];
  let fetched = 0;

  for (const name of ['herolist', 'item', 'summoner', 'ming']) {
    try {
      const r = await fetchCached(`${BASE}/js/${name}.json`, resolve(OUT, `${name}.json`), { refresh });
      if (!r.fromCache) fetched++;
    } catch (e) {
      failures.push(`${name}.json: ${(e as Error).message}`);
    }
  }

  const heroes = await readJson<RawHero[]>(resolve(OUT, 'herolist.json'));
  console.log(`英雄列表：${heroes.length} 个`);

  for (const [i, h] of heroes.entries()) {
    try {
      const r = await fetchCached(
        `${BASE}/herodetail/${h.id_name}.shtml`,
        resolve(OUT, 'herodetail', `${h.id_name}.html`),
        { refresh, encoding: 'gbk' },
      );
      if (!r.fromCache) fetched++;
      if ((i + 1) % 20 === 0) console.log(`  详情页 ${i + 1}/${heroes.length}`);
    } catch (e) {
      failures.push(`${h.cname}(${h.id_name}): ${(e as Error).message}`);
    }
  }

  await writeJson(resolve(OUT, '_fetch.json'), {
    fetchedAt: new Date().toISOString(),
    fetchedAtLocal: hktNow(),
    heroCount: heroes.length,
    failures,
  });
  console.log(`完成：新抓取 ${fetched} 个，失败 ${failures.length} 个`);
  if (failures.length) {
    console.log(failures.join('\n'));
    process.exitCode = 1;
  }
}

main();
