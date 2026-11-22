// 数据包校验：引用完整性、原文引用逐字存在、存疑内容不进入计分。失败时退出码为1。
// 用法：tsx scripts/validate.ts
import { resolve } from 'node:path';
import { ROOT, readJson } from './lib/http.ts';
import type { Bundle, Cond } from '../src/types.ts';
import { buildRelations } from '../src/engine/relations.ts';

const norm = (s: string) => s.replace(/\s+/g, '');
const BANNED = /版本强势|T0|T1|T度|职业选手|高端局|胜率|上分/;

async function main() {
  const b = await readJson<Bundle>(resolve(ROOT, 'public/data/bundle.json'));
  const errors: string[] = [];
  const warns: string[] = [];
  const err = (m: string) => errors.push(m);
  const ids = new Set(b.heroes.map((h) => h.id));
  const tagIds = new Set(b.tags.map((t) => t.id));

  if (ids.size !== b.heroes.length) err('英雄ID重复');
  if (Number.isNaN(Date.parse(b.meta.generatedAt))) err('meta.generatedAt 不是合法时间');

  for (const h of b.heroes) {
    if (h.lanes.length !== 5 || h.lanes.every((x) => x <= 0)) err(`${h.name}: 没有任何分路`);
    if (!h.avatar.startsWith('https://')) err(`${h.name}: 头像地址不是 https`);
    if (h.skills.length < 4) err(`${h.name}: 技能少于4个`);
    const slots = new Map(h.skills.map((s) => [s.slot, s]));
    const allDesc = norm(h.skills.map((s) => s.desc).join('\n'));
    const p = h.profile;
    if (!p) {
      warns.push(`${h.name}: 没有机制档案`);
      continue;
    }
    if (p.status === 'needs_review') warns.push(`${h.name}: 档案待复核`);
    for (const t of p.tags) {
      if (!tagIds.has(t.tag)) err(`${h.name}: 未知标签 ${t.tag}`);
      const skill = slots.get(t.slot);
      if (!skill) err(`${h.name}: 标签 ${t.tag} 指向不存在的技能 ${t.slot}`);
      else if (p.status !== 'needs_review' && !norm(skill.desc).includes(norm(t.quote))) err(`${h.name}: 标签 ${t.tag}@${t.slot} 的引用不在技能原文中：“${t.quote}”`);
    }
    const prose = [...p.strengths, ...p.weaknesses, ...p.interactions].map((x) => ({ text: x.text, quote: x.quote, refs: x.refs }));
    prose.push(...p.combos.map((c) => ({ text: c.why, quote: c.quote, refs: c.order })));
    for (const x of prose) {
      if (BANNED.test(x.text)) err(`${h.name}: 说明文字含禁用表述：${x.text.slice(0, 30)}`);
      if (x.quote && p.status !== 'needs_review' && !allDesc.includes(norm(x.quote))) err(`${h.name}: 说明文字的引用不在技能原文中：“${x.quote}”`);
      for (const r of x.refs ?? []) if (!slots.has(r) && r !== '普攻') err(`${h.name}: 说明文字引用了不存在的技能 ${r}`);
    }
    if (BANNED.test(p.summary)) err(`${h.name}: 概述含禁用表述`);
  }

  for (const e of b.officialEdges) {
    if (!ids.has(e.a) || !ids.has(e.b)) err(`官方关系指向未知英雄 ${e.a}/${e.b}`);
    if (e.a === e.b) err(`官方关系自指 ${e.a}`);
    if (!e.texts.length || e.texts.some((t) => !t.text)) err(`官方关系缺少说明 ${e.a}-${e.b}`);
  }

  const checkCond = (c: Cond, where: string) => {
    for (const t of [...(c.tags ?? []), ...(c.none ?? [])]) if (!tagIds.has(t)) err(`${where}: 条件引用未知标签 ${t}`);
    for (const t of c.heroType ?? []) if (t < 1 || t > 6) err(`${where}: 未知职业编号 ${t}`);
    for (const s of c.all ?? []) checkCond(s, where);
  };
  for (const r of b.rules) {
    checkCond(r.a, `规则 ${r.id}`);
    checkCond(r.b, `规则 ${r.id}`);
    if (!(r.weight > 0 && r.weight <= 1)) err(`规则 ${r.id}: 权重应在 (0,1]`);
    if (!r.basis || !r.condition || !r.reason.includes('{a}') || !r.reason.includes('{b}')) err(`规则 ${r.id}: 缺少依据、成立条件或理由模板`);
  }
  for (const a of b.archetypes) {
    a.needs.forEach((n) => checkCond(n.cond, `体系 ${a.id}`));
    a.weakTo.forEach((w) => checkCond(w.cond, `体系 ${a.id}`));
  }

  for (const p of b.patches) for (const h of p.heroes) if (!ids.has(h.id)) err(`公告 ${p.id} 指向未知英雄 ${h.id}`);
  for (const p of b.kpl?.pairs.list ?? []) {
    if (!ids.has(p.a) || !ids.has(p.b)) err(`职业赛组合指向未知英雄 ${p.a}/${p.b}`);
    if (p.n < b.kpl!.pairs.minN) err(`职业赛组合样本不足 ${p.a}-${p.b} n=${p.n}`);
  }
  for (const c of [...(b.comps?.trios ?? []), ...(b.comps?.lineups ?? [])]) for (const id of c.heroes) if (!ids.has(id)) warns.push(`职业赛阵容含未知英雄 ${id}`);
  for (const c of b.commentary) {
    if (!ids.has(c.a) || (c.b != null && !ids.has(c.b))) err(`解说条目 ${c.id} 指向未知英雄`);
    if (!/^https:\/\//.test(c.url)) err(`解说条目 ${c.id} 缺少来源链接`);
  }

  // 关系：计分的必须有已核实证据；存疑证据不得计分
  const rel = buildRelations(b, (id) => id);
  for (const r of rel.all) {
    if (r.weight > 0 && !r.evidence.length) err(`关系 ${r.a}-${r.b} 有权重但没有证据`);
    if (!r.evidence.length && !r.doubtful.length) err(`关系 ${r.a}-${r.b} 没有任何证据`);
    if (r.weight === 0 && r.evidence.length) err(`关系 ${r.a}-${r.b} 有证据但权重为0`);
    for (const e of r.evidence) {
      if (e.kind === 'commentary' && e.item.status !== 'verified') err(`未核实的解说条目进入了计分 ${e.item.id}`);
      if (e.kind === 'rule') for (const t of [...e.aTags, ...e.bTags]) if (t.status !== 'verified') err(`未核实的标签进入了计分 ${r.a}-${r.b} ${t.tag}`);
    }
  }
  const stale = new Set(b.officialEdges.filter((e) => e.stale).map((e) => `${e.type}:${e.a}:${e.b}`));
  for (const r of rel.all) {
    const k = `${r.type}:${r.a}:${r.b}`;
    if (stale.has(k) && r.evidence.some((e) => e.kind === 'official')) err(`过期的官方关系进入了计分 ${k}`);
  }

  // 营地英雄榜：英雄有效，档位格式正确，比例在0–1之间，每个榜单不超过公开接口的上限
  if (b.camp) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.camp.updateTime)) err(`营地数据日期格式错误 ${b.camp.updateTime}`);
    for (const s of b.camp.segments) {
      for (const [where, list] of [['全部', s.all], ...Object.entries(s.lanes)] as [string, typeof s.all][]) {
        if (list.length > b.camp.limit) err(`营地 ${s.name}/${where}: 超过 ${b.camp.limit} 个`);
        for (const e of list) {
          if (!ids.has(e.id)) err(`营地 ${s.name}/${where}: 未知英雄 ${e.id}`);
          if (!/^T\d$/.test(e.tier)) err(`营地 ${s.name}/${where}: 档位格式错误 ${e.tier}`);
          if (![e.win, e.show, e.ban].every((x) => x >= 0 && x <= 1)) err(`营地 ${s.name}/${where}: 英雄 ${e.id} 的比例超出范围`);
        }
      }
    }
  }

  // 教学内容：出处必须指向已收录的视频，连招里的数字必须对应存在的技能，不含强度断言，不携带字幕原文
  let guideItems = 0;
  for (const [id, g] of Object.entries(b.guides ?? {})) {
    const h = b.heroes.find((x) => x.id === Number(id));
    if (!h) {
      err(`教学内容指向未知英雄 ${id}`);
      continue;
    }
    const vids = new Set(g.videos.map((v) => v.bvid));
    const slots = new Set(h.skills.map((x) => x.slot));
    const check = (where: string, refs: { bvid: string; t: number }[], text: string) => {
      guideItems++;
      if (!refs.length) err(`${h.name} ${where}: 没有出处`);
      for (const r of refs) if (!vids.has(r.bvid) || !(r.t >= 0)) err(`${h.name} ${where}: 出处无效 ${r.bvid}@${r.t}`);
      if (/胜率|T0|T1|版本答案|必选|必ban/i.test(text)) err(`${h.name} ${where}: 含禁用表述：${text.slice(0, 30)}`);
      if ('quote' in (refs[0] ?? {})) err(`${h.name} ${where}: 出处里带了字幕原文`);
    };
    g.combos.forEach((c, i) => {
      check(`连招#${i}`, c.refs, c.name + c.note);
      for (const st of c.steps) if (/^\d$/.test(st) && !slots.has(`${st}技能`)) err(`${h.name} 连招#${i}: 没有“${st}技能”`);
    });
    g.tips.forEach((t, i) => check(`细节#${i}`, t.refs, t.title + t.text));
    g.matchups.forEach((m, i) => {
      check(`克制#${i}`, m.refs, m.claim);
      if (!ids.has(m.hero) || m.hero === h.id) err(`${h.name} 克制#${i}: 指向无效英雄 ${m.hero}`);
    });
  }

  // 个人数据引用的英雄必须存在
  const profile = await readJson<{ pool: { id: number }[]; favoriteHeroes: number[]; customComps: { heroes: number[] }[] }>(resolve(ROOT, 'user/profile.json'));
  for (const id of [...profile.pool.map((p) => p.id), ...profile.favoriteHeroes, ...profile.customComps.flatMap((c) => c.heroes)]) if (!ids.has(id)) err(`user/profile.json 引用了不存在的英雄 ${id}`);

  console.log(`校验：英雄 ${b.heroes.length}，关系 ${rel.all.length}，规则 ${b.rules.length}，教学条目 ${guideItems}；错误 ${errors.length}，提醒 ${warns.length}`);
  if (warns.length) console.log(warns.slice(0, 20).map((w) => `  提醒 ${w}`).join('\n'));
  if (errors.length) {
    console.log(errors.slice(0, 50).map((e) => `  错误 ${e}`).join('\n'));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
