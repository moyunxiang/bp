// 解析 data/raw/official/ → data/derived/official/*.json（进仓库）。
// 用法：tsx scripts/parse-official.ts
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { pinyin } from 'pinyin-pro';
import { RAW, ROOT, readJson, writeJson } from './lib/http.ts';
import type { OfficialHero, OfficialRelation, OfficialSkill } from '../src/types.ts';

const IN = resolve(RAW, 'official');
const OUT = resolve(ROOT, 'data/derived/official');
const IMG = 'https://game.gtimg.cn/images/yxzj/img201606';

interface RawHero {
  ename: number;
  cname: string;
  id_name: string;
  title: string;
  hero_type: number;
  hero_type2?: number;
  time?: string;
  roles?: string;
  isLimitHero?: boolean;
  life_list?: { ename: number; cname: string }[];
}

const clean = (s: string) => s.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();

function htmlToText(el: cheerio.Cheerio<any>): string {
  const html = (el.html() ?? '').replace(/<br\s*\/?>/gi, '\n');
  return cheerio
    .load(`<div>${html}</div>`)('div')
    .text()
    .split('\n')
    .map(clean)
    .filter(Boolean)
    .join('\n');
}

const absUrl = (u: string | undefined) => (u ? (u.startsWith('//') ? `https:${u}` : u) : '');
const ids = (s: string | undefined) =>
  (s ?? '')
    .split('|')
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x) && x > 0);

function parseDetail(html: string, raw: RawHero, known: Set<number>, warn: (m: string) => void): Omit<OfficialHero, 'pinyin' | 'initials' | 'groupId'> {
  const $ = cheerio.load(html);

  // 四维：生存能力 / 攻击伤害 / 技能效果 / 上手难度
  const bars = $('.cover-list .ibar')
    .map((_, e) => Number(/width:\s*(\d+)%/.exec($(e).attr('style') ?? '')?.[1] ?? NaN))
    .get();
  if (bars.length < 4 || bars.slice(0, 4).some(Number.isNaN)) warn('四维评分解析不完整');

  // 技能
  const icons = $('.skill-u1 img')
    .map((_, e) => absUrl($(e).attr('src')))
    .get();
  const skills: OfficialSkill[] = [];
  $('.skill-show .show-list').each((i, e) => {
    const name = clean($(e).find('.skill-name b').text());
    if (!name) return;
    const spans = $(e)
      .find('.skill-name span')
      .map((_, s) => clean($(s).text()))
      .get();
    const cooldown = (spans.find((s) => s.startsWith('冷却值')) ?? '').replace(/^冷却值[:：]\s*/, '');
    const cost = (spans.find((s) => s.startsWith('消耗')) ?? '').replace(/^消耗[:：]\s*/, '');
    skills.push({
      idx: i,
      // 第一个是被动，其余按顺序为1/2/3/4技能
      slot: i === 0 ? '被动' : `${i}技能`,
      name,
      cooldown,
      cost,
      desc: htmlToText($(e).find('.skill-desc')),
      icon: icons[i] ?? '',
    });
  });
  if (skills.length < 4) warn(`技能数量只有 ${skills.length}`);

  // 官方关系：三个区块依次为 最佳搭档 / 压制英雄 / 被压制英雄
  const relBlocks: OfficialRelation[][] = [];
  $('.hero-info-box .hero-info').each((_, block) => {
    const out: OfficialRelation[] = [];
    const cards = $(block).find('.hero-relate-card');
    if (cards.length) {
      cards.each((_, c) => {
        const id = Number(/(\d+)\.shtml/.exec($(c).find('a').first().attr('href') ?? '')?.[1]);
        out.push({ id, text: clean($(c).find('.hero-relate-desc').text()) });
      });
    } else {
      const linkIds = $(block)
        .find('.hero-list li a')
        .map((_, a) => Number(/(\d+)\.shtml/.exec($(a).attr('href') ?? '')?.[1]))
        .get();
      const texts = $(block)
        .find('.hero-list-desc p')
        .map((_, p) => clean($(p).text()))
        .get();
      linkIds.forEach((id, i) => out.push({ id, text: texts[i] ?? '' }));
    }
    relBlocks.push(out);
  });
  if (relBlocks.length !== 3) warn(`关系区块数量为 ${relBlocks.length}`);
  for (const r of relBlocks.flat()) {
    if (!known.has(r.id)) warn(`关系指向未知英雄ID ${r.id}`);
    if (r.id === raw.ename) warn('关系自引用');
    if (!r.text) warn(`关系 ${r.id} 缺少说明文字`);
  }
  // 去掉不在英雄列表中的目标，避免悬空引用
  const keep = (list: OfficialRelation[] | undefined) => (list ?? []).filter((r) => known.has(r.id) && r.id !== raw.ename);

  const skillText = skills.map((s) => `${s.name}|${s.cooldown}|${s.cost}|${s.desc}`).join('\n');

  return {
    id: raw.ename,
    name: raw.cname,
    idName: raw.id_name,
    title: raw.title,
    heroType: raw.hero_type,
    heroType2: raw.hero_type2 ?? null,
    releaseDate: raw.time ? raw.time.replace(/\./g, '-') : null,
    isLimited: !!raw.isLimitHero,
    officialRoles: ids(raw.roles),
    avatar: `${IMG}/heroimg/${raw.ename}/${raw.ename}.jpg`,
    ratings: { survive: bars[0] ?? 0, attack: bars[1] ?? 0, skill: bars[2] ?? 0, difficulty: bars[3] ?? 0 },
    skills,
    skillHash: createHash('sha1').update(skillText).digest('hex').slice(0, 12),
    rune: { ids: ids($('.sugg-u1').attr('data-ming')), tips: clean($('.sugg-tips').first().text()).replace(/^Tips[:：]\s*/, '') },
    builds: $('.equip-info')
      .map((_, e) => ({
        items: ids($(e).find('.equip-list').attr('data-item')),
        tips: clean($(e).find('.equip-tips').text()).replace(/^Tips[:：]\s*/, ''),
      }))
      .get()
      .filter((b) => b.items.length),
    summoners: ids($('#skill3').attr('data-skill')),
    relations: { partners: keep(relBlocks[0]), counters: keep(relBlocks[1]), counteredBy: keep(relBlocks[2]) },
    sourceUrl: `https://pvp.qq.com/web201605/herodetail/${raw.id_name}.shtml`,
  };
}

async function main() {
  const rawHeroes = await readJson<RawHero[]>(resolve(IN, 'herolist.json'));
  const fetchInfo = await readJson<{ fetchedAt: string }>(resolve(IN, '_fetch.json'));
  const known = new Set(rawHeroes.map((h) => h.ename));
  const warnings: string[] = [];
  const heroes: OfficialHero[] = [];

  // 互斥分组：同一英雄的多个形态/命格在BP中只能占一个位置
  const groupOf = new Map<number, string>();
  for (const h of rawHeroes) {
    if (h.life_list?.length) for (const m of h.life_list) groupOf.set(m.ename, `life-${Math.min(...h.life_list.map((x) => x.ename))}`);
    if (h.cname.startsWith('元流之子')) groupOf.set(h.ename, 'yuanliuzhizi');
  }

  for (const raw of rawHeroes) {
    const html = await readFile(resolve(IN, 'herodetail', `${raw.id_name}.html`), 'utf-8');
    const base = parseDetail(html, raw, known, (m) => warnings.push(`${raw.cname}: ${m}`));
    const plain = raw.cname.replace(/[（(].*?[)）]/g, '');
    const py = pinyin(plain, { toneType: 'none', type: 'array', nonZh: 'consecutive' });
    heroes.push({
      ...base,
      groupId: groupOf.get(raw.ename) ?? null,
      pinyin: py.join('').toLowerCase(),
      initials: py.map((s) => s[0]).join('').toLowerCase(),
    });
  }

  heroes.sort((a, b) => a.id - b.id);
  await writeJson(resolve(OUT, 'heroes.json'), { fetchedAt: fetchInfo.fetchedAt, source: 'https://pvp.qq.com/web201605/herolist.shtml', heroes });

  // 装备 / 铭文 / 召唤师技能：只保留展示所需字段
  const items = await readJson<any[]>(resolve(IN, 'item.json'));
  const mings = await readJson<any[]>(resolve(IN, 'ming.json'));
  const summoners = await readJson<any[]>(resolve(IN, 'summoner.json'));
  const strip = (s: string) => clean(cheerio.load(`<div>${(s ?? '').replace(/<br\s*\/?>/gi, '；')}</div>`)('div').text());
  await writeJson(resolve(OUT, 'equipment.json'), {
    fetchedAt: fetchInfo.fetchedAt,
    items: items.map((i) => ({ id: i.item_id, name: i.item_name, desc: [strip(i.des1), strip(i.des2 ?? '')].filter(Boolean).join('；') })),
    runes: mings.map((m) => ({ id: Number(m.ming_id), name: m.ming_name, color: m.ming_type, desc: strip(m.ming_des) })),
    summoners: summoners.map((s) => ({ id: s.summoner_id, name: s.summoner_name, desc: strip(s.summoner_description) })),
  });

  const rel = heroes.reduce((n, h) => n + h.relations.partners.length + h.relations.counters.length + h.relations.counteredBy.length, 0);
  console.log(`英雄 ${heroes.length}，技能 ${heroes.reduce((n, h) => n + h.skills.length, 0)}，官方关系 ${rel}，警告 ${warnings.length}`);
  if (warnings.length) console.log(warnings.join('\n'));
}

main();
