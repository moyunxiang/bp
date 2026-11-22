// 阵容底线的依据：近一年职业赛阵容里，各条底线（见 src/engine/comp.ts 的 COMP_FLOORS）的满足比例。
// 同时算一份对照：把各位置的常用英雄按出场频率独立抽样拼成阵容，满足比例是多少。
// 两者几乎一样，说明职业队是“按位置选常用英雄”自然满足的，这也是模型学不出这一项力度的原因。
// 结果写入 data/derived/kpl/floors.json（只有比例，进仓库）。需要本地的职业赛原始数据。
// 用法：tsx scripts/build-floors.ts
import { resolve } from 'node:path';
import { ROOT, writeJson } from './lib/http.ts';
import { POS_TO_LANE, loadBattles } from './lib/kpl.ts';
import { dayOffset } from './lib/kpl-stats.ts';
import { assemble, loadInputs } from './lib/assemble.ts';
import { COMP_FLOORS } from '../src/engine/comp.ts';
import type { CompFloorStats, HeroData } from '../src/types.ts';

const WINDOW_DAYS = 365;
const SAMPLES = 40000;

async function main() {
  const { bundle } = assemble(await loadInputs());
  const byId = new Map(bundle.heroes.map((h) => [h.id, h]));
  const { battles } = await loadBattles();
  if (!battles.length) throw new Error('没有KPL数据，请先运行 fetch-kpl');
  const to = battles[battles.length - 1].start_time.slice(0, 10);
  const from = dayOffset(to, WINDOW_DAYS);

  const teams: HeroData[][] = [];
  const laneDist: Map<number, number>[] = [0, 1, 2, 3, 4].map(() => new Map());
  for (const b of battles) {
    if (b.start_time.slice(0, 10) < from) continue;
    for (const camp of [1, 2] as const) {
      const ps = b.players.filter((p) => p.camp === camp);
      const hs = ps.map((p) => byId.get(p.hero)).filter((h): h is HeroData => !!h);
      if (hs.length !== 5) continue;
      teams.push(hs);
      for (const p of ps) {
        const lane = POS_TO_LANE[p.pos_desc ?? ''];
        if (lane && byId.has(p.hero)) laneDist[lane - 1].set(p.hero, (laneDist[lane - 1].get(p.hero) ?? 0) + 1);
      }
    }
  }

  // 对照：每个位置按该位置的出场频率独立抽一个英雄（固定随机种子，结果可重现）
  let seed = 20261122;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const sample = (m: Map<number, number>) => {
    const total = [...m.values()].reduce((s, x) => s + x, 0);
    let r = rnd() * total;
    for (const [k, v] of m) if ((r -= v) < 0) return k;
    return [...m.keys()][0];
  };
  const shuffled: HeroData[][] = [];
  while (shuffled.length < SAMPLES) {
    const ids = laneDist.map(sample);
    if (new Set(ids).size === 5) shuffled.push(ids.map((id) => byId.get(id)!));
  }

  const share = (ts: HeroData[][], test: (h: HeroData) => boolean, min: number) => +(ts.filter((t) => t.filter(test).length >= min).length / ts.length).toFixed(4);
  const out: CompFloorStats = {
    generatedAt: new Date().toISOString(),
    from,
    to,
    teams: teams.length,
    floors: Object.fromEntries(
      COMP_FLOORS.map((f) => [
        f.key,
        {
          must: f.must ? { min: f.must, pro: share(teams, f.test, f.must), shuffled: share(shuffled, f.test, f.must) } : null,
          should: f.should > f.must ? { min: f.should, pro: share(teams, f.test, f.should), shuffled: share(shuffled, f.test, f.should) } : null,
        },
      ]),
    ),
  };
  await writeJson(resolve(ROOT, 'data/derived/kpl/floors.json'), out);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`阵容底线：${from} ~ ${to} 共 ${teams.length} 个职业队阵容；对照为各位置常用英雄独立抽样 ${SAMPLES} 组`);
  for (const f of COMP_FLOORS) {
    const s = out.floors[f.key];
    for (const [tier, v] of [['必须', s.must], ['最好', s.should]] as const) if (v) console.log(`  ${f.label} ≥${v.min}（${tier}）：职业 ${pct(v.pro)}，对照 ${pct(v.shuffled)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
