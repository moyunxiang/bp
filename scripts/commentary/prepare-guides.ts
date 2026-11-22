// 为每个英雄生成一份提炼输入：官方技能表 + 该英雄各教学视频的字幕。
// 输出到 data/raw/commentary/inputs/{英雄ID}.md（含第三方字幕原文，不进仓库）。
// 用法：tsx scripts/commentary/prepare-guides.ts        只生成还没有提炼结果的英雄
//       tsx scripts/commentary/prepare-guides.ts --all  全部重新生成
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { RAW, ROOT, exists, readJson, writeFileSafe } from '../lib/http.ts';
import type { OfficialHero } from '../../src/types.ts';
import type { HeroVideo } from './hero-guides.ts';

const DIR = resolve(RAW, 'commentary');
const ALL = process.argv.includes('--all');

async function main() {
  const { heroes } = await readJson<{ heroes: OfficialHero[] }>(resolve(ROOT, 'data/derived/official/heroes.json'));
  const index = await readJson<Record<string, HeroVideo[] | boolean>>(resolve(DIR, 'hero-videos.json'));
  const names = heroes.map((h) => h.name).join('、');
  const todo: string[] = [];
  for (const h of heroes) {
    const videos = index[h.id];
    if (!Array.isArray(videos) || !videos.length) continue;
    if (!ALL && (await exists(resolve(DIR, 'distilled', `${h.id}.json`)))) continue;
    const parts = [
      `# ${h.name}（英雄ID ${h.id}）`,
      '',
      '## 官方技能（steps 里的数字以这里的顺序为准）',
      ...h.skills.map((s) => `- ${s.slot}【${s.name}】：${s.desc.replace(/\s+/g, ' ')}`),
      '',
      '## 规范英雄名（matchups.hero 只能用这些名字）',
      names,
    ];
    for (const v of videos) {
      const text = await readFile(resolve(DIR, 'subtitles', `${v.bvid}.txt`), 'utf-8');
      parts.push('', `## 视频 ${v.bvid}（时长 ${v.seconds} 秒）`, text.trim());
    }
    await writeFileSafe(resolve(DIR, 'inputs', `${h.id}.md`), parts.join('\n') + '\n');
    todo.push(`${h.id}:${h.name}`);
  }
  console.log(`已生成 ${todo.length} 个英雄的提炼输入：data/raw/commentary/inputs/`);
  console.log(todo.join(' '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
