// 读取本地KPL原始逐局数据（data/raw/kpl/），供聚合与回测使用。
import { resolve } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { RAW, exists } from './http.ts';
import type { Lane } from '../../src/types.ts';

export interface Battle {
  battle_id: string;
  league_id: string;
  match_id: string;
  bo: number;
  stage: string;
  start_time: string; // 系列赛开始时间
  battle_seq: number;
  win_camp: number;
  duration_ms: number;
  camp1_team: string;
  camp2_team: string;
  bp: { camp: 1 | 2; pick: 0 | 1; hero: number; pos: number }[];
  players: { camp: 1 | 2; team: string; hero: number; pos: number; pos_desc: string; player: string }[];
}

export const POS_TO_LANE: Record<string, Lane> = { 对抗路: 1, 打野: 2, 中路: 3, 发育路: 4, 游走: 5 };

/** 读取全部对局，按系列赛时间、局序排序。只返回有完整BP和10名选手的对局。 */
export async function loadBattles(): Promise<{ battles: Battle[]; total: number }> {
  const dir = resolve(RAW, 'kpl/battles');
  const out: Battle[] = [];
  let total = 0;
  if (!(await exists(dir))) return { battles: out, total };
  const seen = new Set<string>();
  for (const f of (await readdir(dir)).filter((x) => x.endsWith('.jsonl'))) {
    for (const line of (await readFile(resolve(dir, f), 'utf-8')).split('\n')) {
      if (!line.trim()) continue;
      let b: Battle;
      try {
        b = JSON.parse(line);
      } catch {
        continue; // 被中断的半行
      }
      if (seen.has(b.battle_id)) continue;
      seen.add(b.battle_id);
      total++;
      const picks = b.bp.filter((x) => x.pick === 1 && x.hero > 0);
      if (picks.length !== 10 || b.players.length !== 10) continue;
      out.push(b);
    }
  }
  out.sort((a, b) => a.start_time.localeCompare(b.start_time) || a.match_id.localeCompare(b.match_id) || a.battle_seq - b.battle_seq);
  return { battles: out, total };
}

/** BO7第7局为“巅峰对决”盲选，不受全局BP限制，统计时单独剔除。 */
export const isBlindDecider = (b: Battle) => b.bo === 7 && b.battle_seq === 7;

export const teamOfCamp = (b: Battle, camp: 1 | 2) => (camp === 1 ? b.camp1_team : b.camp2_team);
