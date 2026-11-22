// 抓取KPL等官方赛事的逐局BP到 data/raw/kpl/（不进仓库）。
// 来源：腾讯官方赛事数据中心 prod.comp.smoba.qq.com/leaguesite（无需登录）。
// 单线程、每秒至多1次请求、可断点续跑；从最新赛事往前抓。
// 用法：tsx scripts/fetch-kpl.ts [--since=2020] [--refresh-matches] [--max=N]
import { resolve } from 'node:path';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { RAW, exists, fetchText, writeJson, readJson } from './lib/http.ts';

const BASE = 'https://prod.comp.smoba.qq.com/leaguesite';
const OUT = resolve(RAW, 'kpl');
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const since = Number(arg('since') ?? 2020);
const max = Number(arg('max') ?? Infinity);
const refreshMatches = process.argv.includes('--refresh-matches');
const CONCURRENCY = Number(arg('concurrency') ?? 4);

interface League {
  league_id: string;
  league_name: string;
  league_type_name: string;
  start_time: string;
  end_time: string;
  year: number;
  status: number;
}
interface Match {
  match_id: string;
  bo: number;
  start_time: string;
  status: number;
  match_stage_desc: string;
  camp1: { team_id: string; team_name: string };
  camp2: { team_id: string; team_name: string };
  match_battle_video_list?: { battle_id: string; battle_seq: number }[];
}

async function getJson<T>(url: string): Promise<T> {
  const text = await fetchText(url, { minIntervalMs: 1000 });
  const j = JSON.parse(text);
  if (j.code !== 200) throw new Error(`接口返回 code=${j.code} ${url}`);
  return (j.results ?? j.data) as T;
}

/** 只保留后续统计用得到的字段，减小体积。 */
function slim(b: any, match: Match, league: League) {
  return {
    battle_id: b.battle_id,
    league_id: league.league_id,
    match_id: match.match_id,
    bo: match.bo,
    stage: match.match_stage_desc,
    start_time: match.start_time,
    battle_seq: b.battle_seq,
    win_camp: b.win_camp,
    duration_ms: b.game_duration,
    camp1_team: b.camp1?.team_id,
    camp2_team: b.camp2?.team_id,
    bp: (b.bp_list ?? []).map((x: any) => ({
      camp: x.camp,
      pick: x.is_ban_or_pick,
      hero: x.hero_id,
      pos: x.position,
    })),
    players: (b.battle_player_list ?? []).map((p: any) => ({
      camp: p.camp,
      team: p.team_id,
      hero: p.hero_id,
      pos: p.position,
      pos_desc: p.position_desc,
      player: p.player_name,
    })),
  };
}

async function loadDone(file: string): Promise<Set<string>> {
  const done = new Set<string>();
  if (!(await exists(file))) return done;
  const content = await readFile(file, 'utf-8');
  // 上次被中断时可能留下没有换行的半行；补一个换行，避免下一条记录接在它后面
  if (content.length && !content.endsWith('\n')) await appendFile(file, '\n');
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      done.add(JSON.parse(line).battle_id);
    } catch {
      // 忽略被中断的半行
    }
  }
  return done;
}

async function main() {
  await mkdir(resolve(OUT, 'battles'), { recursive: true });
  await mkdir(resolve(OUT, 'matches'), { recursive: true });

  const leagues = await getJson<League[]>(`${BASE}/leagues/open`);
  await writeJson(resolve(OUT, 'leagues.json'), leagues);
  const todo = leagues.filter((l) => l.year >= since).sort((a, b) => b.start_time.localeCompare(a.start_time));
  console.log(`赛事 ${leagues.length} 个，本次处理 ${todo.length} 个（${since}年起，从新到旧）`);

  let fetched = 0;
  let failed = 0;
  for (const league of todo) {
    const matchFile = resolve(OUT, 'matches', `${league.league_id}.json`);
    let matches: Match[];
    // 已结束的赛事赛程不再变化，用缓存
    if (!refreshMatches && league.status === 2 && (await exists(matchFile))) {
      matches = await readJson<Match[]>(matchFile);
    } else {
      matches = await getJson<Match[]>(`${BASE}/matches/open?league_id=${league.league_id}`);
      await writeJson(matchFile, matches);
    }
    const battleFile = resolve(OUT, 'battles', `${league.league_id}.jsonl`);
    const done = await loadDone(battleFile);
    const pending: { id: string; match: Match }[] = [];
    for (const m of matches) {
      for (const b of m.match_battle_video_list ?? []) {
        if (b.battle_id && !done.has(b.battle_id)) pending.push({ id: b.battle_id, match: m });
      }
    }
    console.log(`${league.league_name}：系列赛 ${matches.length}，已有 ${done.size} 局，待抓 ${pending.length} 局`);
    // 接口单次响应要数秒：用少量并发等待，但请求发起仍受全局限速（每秒至多1次）
    const queue = [...pending];
    const worker = async () => {
      for (;;) {
        const p = queue.shift();
        if (!p || fetched >= max) return;
        if (failed > 50) throw new Error('失败次数过多，停止（接口可能已变化或被限流）');
        try {
          const b = await getJson<any>(`${BASE}/battle/open?battle_id=${p.id}`);
          await appendFile(battleFile, JSON.stringify(slim(b, p.match, league)) + '\n');
          fetched++;
          if (fetched % 200 === 0) console.log(`  累计新抓 ${fetched} 局 ${new Date().toTimeString().slice(0, 8)}`);
        } catch (e) {
          failed++;
          console.log(`  失败 ${p.id}: ${(e as Error).message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (fetched >= max) break;
  }
  console.log(`完成：新抓 ${fetched} 局，失败 ${failed} 局`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
