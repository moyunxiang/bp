// 生成机制档案提取/盲审用的批次输入文件 data/curated/_work/batch-*.json（不进仓库）。
// 用法：
//   tsx scripts/make-batches.ts --ids=105,141 --name=pilot
//   tsx scripts/make-batches.ts --todo --size=10      只包含尚无档案或技能原文已变化的英雄
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { ROOT, exists, readJson, writeJson } from './lib/http.ts';
import { HERO_TYPE_NAME, type OfficialHero } from '../src/types.ts';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const WORK = resolve(ROOT, 'data/curated/_work');

async function main() {
  const { heroes } = await readJson<{ heroes: OfficialHero[] }>(resolve(ROOT, 'data/derived/official/heroes.json'));
  const stampsPath = resolve(ROOT, 'data/curated/stamps.json');
  const stamps: Record<string, string> = (await exists(stampsPath)) ? await readJson(stampsPath) : {};

  let selected: OfficialHero[];
  const idsArg = arg('ids');
  if (idsArg) {
    const want = new Set(idsArg.split(',').map(Number));
    selected = heroes.filter((h) => want.has(h.id));
  } else if (process.argv.includes('--todo')) {
    selected = heroes.filter((h) => stamps[h.id] !== h.skillHash);
  } else {
    throw new Error('需要 --ids=... 或 --todo');
  }

  const size = Number(arg('size') ?? 10);
  const name = arg('name') ?? 'b';
  if (process.argv.includes('--clean')) await rm(WORK, { recursive: true, force: true });

  const files: string[] = [];
  for (let i = 0; i < selected.length; i += size) {
    const chunk = selected.slice(i, i + size);
    const file = resolve(WORK, `batch-${name}-${String(i / size + 1).padStart(2, '0')}.json`);
    await writeJson(file, {
      heroes: chunk.map((h) => ({
        id: h.id,
        name: h.name,
        heroType: HERO_TYPE_NAME[h.heroType],
        skills: h.skills.map((s) => ({ slot: s.slot, name: s.name, cooldown: s.cooldown, cost: s.cost, desc: s.desc })),
      })),
    });
    files.push(file);
    console.log(`${file}  ${chunk.map((h) => `${h.id}${h.name}`).join(' ')}`);
  }
  console.log(`共 ${selected.length} 个英雄，${files.length} 个批次`);
}

main();
