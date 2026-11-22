// KPL聚合统计：data/raw/kpl → data/derived/kpl/stats.json、comps.json（进仓库，仅聚合结果）。
// 统计口径见 scripts/lib/kpl-stats.ts。
// 用法：tsx scripts/build-kpl.ts
import { resolve } from 'node:path';
import { ROOT, readJson, writeJson } from './lib/http.ts';
import { loadBattles } from './lib/kpl.ts';
import { computeKpl } from './lib/kpl-stats.ts';
import type { OfficialHero } from '../src/types.ts';

async function main() {
  const { heroes } = await readJson<{ heroes: OfficialHero[] }>(resolve(ROOT, 'data/derived/official/heroes.json'));
  const { battles, total } = await loadBattles();
  const out = computeKpl(battles, heroes, total);
  if (!out) throw new Error('没有KPL数据，请先运行 fetch-kpl');
  const { stats, comps } = out;
  await writeJson(resolve(ROOT, 'data/derived/kpl/stats.json'), stats);
  await writeJson(resolve(ROOT, 'data/derived/kpl/comps.json'), comps);

  const name = (id: number) => heroes.find((h) => h.id === id)?.name ?? id;
  const g1 = (k: 'g1Recent' | 'g1Year') =>
    Object.entries(stats.heroes)
      .map(([id, s]) => ({ id: Number(id), ...s[k] }))
      .sort((a, b) => b.pick + b.ban - a.pick - a.ban)
      .slice(0, 10)
      .map((e) => `${name(e.id)} 选${e.pick}禁${e.ban}`)
      .join('，');
  console.log(`对局：已抓 ${total}，可用 ${battles.length}（${stats.coverage.from} ~ ${stats.coverage.to}）`);
  console.log(`第一局：近期窗口 ${stats.heat.recent.games} 局，一年窗口 ${stats.heat.year.games} 局；共现窗口队伍场次 ${stats.pairs.teamGames}；达标组合 ${stats.pairs.list.length}；三人组 ${comps.trios.length}；完整阵容 ${comps.lineups.length}`);
  console.log(`近期第一局禁选最多（共${stats.heat.recent.games}局）：${g1('g1Recent')}`);
  console.log('提升度最高：', stats.pairs.list.slice(0, 8).map((p) => `${name(p.a)}+${name(p.b)} n=${p.n} lift=${p.lift}`).join('，'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
