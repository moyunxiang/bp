// 数据更新总入口：抓取 → 整理 → 校验 → 生成数据包。电脑开机时手动运行即可。
// 某一步抓取失败时保留旧数据继续往下走，最后汇总报告；校验失败则不生成新的数据包。
// 用法：npm run update-data [-- --skip-kpl] [--backtest] [--commentary]
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ROOT, readJson } from './lib/http.ts';
import type { BundleMeta } from '../src/types.ts';

const has = (flag: string) => process.argv.includes(flag);
const results: { step: string; ok: boolean; seconds: number }[] = [];

function run(step: string, script: string, args: string[] = [], required = false): boolean {
  console.log(`\n━━ ${step} ━━`);
  const t0 = Date.now();
  const r = spawnSync('npx', ['tsx', script, ...args], { cwd: ROOT, stdio: 'inherit' });
  const ok = r.status === 0;
  results.push({ step, ok, seconds: Math.round((Date.now() - t0) / 1000) });
  if (!ok && required) {
    summary();
    console.log(`\n“${step}”失败，已停止。public/data 里的数据包保持不变。`);
    process.exit(1);
  }
  return ok;
}

function summary() {
  console.log('\n━━ 汇总 ━━');
  for (const r of results) console.log(`  ${r.ok ? '完成' : '失败'}  ${r.step}（${r.seconds}秒）`);
}

async function main() {
  // 1. 官方英雄资料：抓取失败时沿用上次的解析结果
  if (run('抓取官方英雄资料', 'scripts/fetch-official.ts', ['--refresh'])) run('解析官方英雄资料', 'scripts/parse-official.ts', [], true);
  // 2. 版本公告
  run('抓取正式服公告', 'scripts/fetch-news.ts', ['--refresh']);
  // 3. 职业赛：只增量抓取去年以来的赛事（已抓的对局会跳过）
  if (!has('--skip-kpl')) {
    run('抓取职业赛对局（增量）', 'scripts/fetch-kpl.ts', [`--since=${new Date().getFullYear() - 1}`, '--refresh-matches', '--concurrency=8']);
    run('职业赛聚合统计', 'scripts/build-kpl.ts');
  }
  // 4. 机制档案：重新校验原文引用；官方技能原文变化的英雄会被标为待复核
  run('校验并合并机制档案', 'scripts/build-profiles.ts', [], true);
  // 5. 解说（可选，需要 .env.local 里的 BILI_COOKIE）
  if (has('--commentary')) {
    run('发现解说视频', 'scripts/commentary/discover.ts');
    run('读取字幕', 'scripts/commentary/fetch-subtitles.ts');
  }
  run('汇总解说条目', 'scripts/commentary/build.ts');
  // 6. 回测（可选，约1–2分钟）
  if (has('--backtest')) run('回测', 'scripts/backtest.ts');
  // 7. 生成数据包并校验
  run('生成数据包', 'scripts/build-data.ts', [], true);
  run('校验数据包', 'scripts/validate.ts', [], true);

  summary();
  const meta = await readJson<BundleMeta>(resolve(ROOT, 'public/data/meta.json'));
  const todo = [...meta.pending.needsReview, ...meta.pending.missingProfile];
  console.log(`\n数据包已更新：${meta.generatedAt}；赛季 ${meta.season ?? '未识别'}；最近版本公告 ${meta.latestPatchDate ?? '未知'}`);
  if (todo.length) {
    console.log(`\n有 ${todo.length} 个英雄的机制档案需要撰写或复核（新英雄，或官方技能原文已变化）：${todo.join('、')}`);
    console.log('这些英雄暂时不参与机制规则计分。处理方法见 README 的“更新机制档案”一节（在 Claude Code 里运行）。');
  }
  console.log('\n确认无误后提交并推送，GitHub Actions 会自动重新发布网站：\n  git add -A && git commit -m "Update data" && git push');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
