// 生成前端数据包 public/data/bundle.json。
// 用法：tsx scripts/build-data.ts [--keep-date]
//   --keep-date：沿用现有数据包的生成时间。定时任务只刷新营地英雄榜时使用，避免把其他没有更新的数据也显示成“刚更新”。
import { resolve } from 'node:path';
import { ROOT, exists, readJson, writeJson } from './lib/http.ts';
import { assemble, loadInputs } from './lib/assemble.ts';
import { buildRelations } from '../src/engine/relations.ts';

async function main() {
  const { bundle, staleEdges } = assemble(await loadInputs());
  const metaFile = resolve(ROOT, 'public/data/meta.json');
  if (process.argv.includes('--keep-date') && (await exists(metaFile))) bundle.meta.generatedAt = (await readJson<{ generatedAt: string }>(metaFile)).generatedAt;
  const heroes = bundle.heroes;

  // 用与前端相同的代码计算一次关系，得到各类数量
  const tagName = (id: string) => bundle.tags.find((t) => t.id === id)?.name ?? id;
  const rel = buildRelations(bundle, tagName);
  const kinds = { official: 0, rule: 0, kpl: 0, commentary: 0 };
  const perRule: Record<string, number> = {};
  for (const r of rel.all) {
    for (const k of new Set(r.evidence.map((e) => e.kind))) kinds[k]++;
    for (const e of r.evidence) if (e.kind === 'rule') perRule[e.rule.id] = (perRule[e.rule.id] ?? 0) + 1;
  }
  const scored = rel.all.filter((r) => r.weight > 0);
  const totalPairs = (heroes.length * (heroes.length - 1)) / 2;
  const pairsWithAny = new Set(scored.map((r) => (r.a < r.b ? `${r.a}-${r.b}` : `${r.b}-${r.a}`))).size;
  bundle.meta.counts = {
    heroes: heroes.length,
    limitedHeroes: heroes.filter((h) => h.isLimited).length,
    skills: heroes.reduce((s, h) => s + h.skills.length, 0),
    officialEdges: bundle.officialEdges.length,
    officialStale: staleEdges,
    relationsScored: scored.length,
    counterRelations: scored.filter((r) => r.type === 'counter').length,
    synergyRelations: scored.filter((r) => r.type === 'synergy').length,
    withOfficial: kinds.official,
    withRule: kinds.rule,
    withKpl: kinds.kpl,
    withCommentary: kinds.commentary,
    rules: bundle.rules.length,
    playbook: bundle.playbook.length,
    archetypes: bundle.archetypes.length,
    pairCoveragePct: +((pairsWithAny / totalPairs) * 100).toFixed(1),
    patches: bundle.patches.length,
    commentary: bundle.commentary.length,
    kplBattles: bundle.kpl?.coverage.battlesUsable ?? 0,
  };

  await writeJson(resolve(ROOT, 'public/data/bundle.json'), bundle, false);
  await writeJson(resolve(ROOT, 'public/data/meta.json'), bundle.meta);

  const c = bundle.meta.counts;
  console.log(`英雄 ${c.heroes}（限时 ${c.limitedHeroes}）；官方关系边 ${c.officialEdges}（过期 ${c.officialStale}）`);
  console.log(`计分关系 ${c.relationsScored}：克制 ${c.counterRelations}，配合 ${c.synergyRelations}；含官方 ${c.withOfficial}，含规则 ${c.withRule}，含KPL ${c.withKpl}；英雄对覆盖率 ${c.pairCoveragePct}%`);
  console.log('各规则触发数：', Object.entries(perRule).map(([k, v]) => `${k}=${v}`).join('  '));
  const src: Record<string, number> = {};
  for (const h of heroes) {
    const key = h.laneSource.replace(/\d+/g, 'N');
    src[key] = (src[key] ?? 0) + 1;
  }
  console.log('分路来源：', JSON.stringify(src));
  const noLane = heroes.filter((h) => h.lanes.every((x) => x === 0)).map((h) => h.name);
  if (noLane.length) console.log('没有任何分路的英雄：', noLane.join('、'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
