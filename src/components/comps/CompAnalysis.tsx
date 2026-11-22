// 阵容分析：分路、阵容构成、战术体系、队内协同、被克点、替代英雄。3–5个英雄都可用。
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LANE_NAME, type HeroData } from '../../types.ts';
import { useEngine } from '../../lib/data.ts';
import { heroesMatching, substitutes, teamThreats } from '../../engine/comp.ts';
import type { Relation } from '../../engine/relations.ts';
import { EvidenceList, KindBadges, RelationCard } from '../Evidence.tsx';
import { HeroAvatar, LaneBadge } from '../ui.tsx';
import { DAMAGE_HOW, DAMAGE_NAME, FEATURES, LOW_FIT, PROFILE_STATE, laneFitText, summarize } from './analysis.ts';
import { HeroChips, LimitedChip, Note, Toggle, resolveHeroes, sameGroup, useTagName } from './shared.tsx';

function Block({ title, how, children }: { title: string; how?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-3 first:border-t-0 first:pt-0">
      <h3 className="text-[13.5px] font-semibold text-ink">{title}</h3>
      {how && <p className="mt-0.5 text-[12px] leading-relaxed text-mute">{how}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

function MiniHero({ hero, size = 20 }: { hero: HeroData; size?: number }) {
  return (
    <Link to={`/heroes/${hero.id}`} className="inline-flex items-center gap-1 text-[12.5px] text-sub hover:text-blue">
      <HeroAvatar hero={hero} size={size} />
      {hero.name}
    </Link>
  );
}

export function CompAnalysis({ heroIds }: { heroIds: number[] }) {
  const { bundle, byId, rel } = useEngine();
  const tagName = useTagName();
  const { heroes, missing } = useMemo(() => resolveHeroes(byId, heroIds), [byId, heroIds]);
  const s = useMemo(() => summarize(heroes, bundle.archetypes, tagName), [heroes, bundle]); // tagName 随 bundle 不变

  // 候选池：非限时、不在阵容里、不与阵容中英雄同组
  const pool = useMemo(() => bundle.heroes.filter((h) => !h.isLimited && !heroes.some((t) => t.id === h.id || sameGroup(t, h))), [bundle, heroes]);

  if (!heroes.length) {
    return (
      <div className="space-y-2">
        {missing.length > 0 && <Note tone="warn">以下英雄ID在当前数据中不存在，已忽略：{missing.join('、')}</Note>}
        <Note>还没有英雄。选择英雄后显示阵容分析。</Note>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {missing.length > 0 && <Note tone="warn">以下英雄ID在当前数据中不存在，已忽略：{missing.join('、')}</Note>}
      {heroes.length < 3 && <Note>目前只有{heroes.length}个英雄。阵容构成、战术体系等项在3–5人时才有参考意义，下面的结果只按已选英雄计算。</Note>}

      <LanesBlock s={s} />
      <FeaturesBlock s={s} tagName={tagName} />
      <ArchetypeBlock s={s} />
      <SynergyBlock heroes={heroes} getSynergy={(a, b) => rel.getSynergy(a, b)} />
      <ThreatBlock s={s} pool={pool} tagName={tagName} />
      <SubstituteBlock s={s} pool={pool} tagName={tagName} />
    </div>
  );
}

// ---------- 分路 ----------

function LanesBlock({ s }: { s: ReturnType<typeof summarize> }) {
  const rows = [...s.lanes].sort((a, b) => a.lane - b.lane);
  return (
    <Block title="分路" how={`按每个英雄的分路适配权重（来源见鼠标悬停：职业赛分路分布与官方分路），求总和最大的分配；适配度≥${LOW_FIT}视为常规分路。`}>
      <div className="flex flex-wrap gap-2">
        {rows.map((r) => (
          <div key={r.hero.id} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${r.fit < LOW_FIT ? 'border-warn/40 bg-warn/5' : 'border-line bg-panel2/60'}`} title={`分路数据来源：${r.hero.laneSource}`}>
            <LaneBadge lane={r.lane} />
            <MiniHero hero={r.hero} size={22} />
            <span className={`text-[11.5px] ${r.fit < LOW_FIT ? 'text-warn' : 'text-mute'}`}>适配{r.fit.toFixed(2)}</span>
          </div>
        ))}
      </div>
      {s.lowFit.length > 0 && (
        <ul className="mt-2 space-y-1">
          {s.lowFit.map((r) => (
            <li key={r.hero.id} className="text-[12px] text-warn">
              {laneFitText(r)}
            </li>
          ))}
        </ul>
      )}
      {s.openLanes.length > 0 && s.heroes.length < 5 && (
        <p className="mt-2 text-[12px] text-mute">
          尚无人占用的分路：
          {s.openLanes.map((l) => LANE_NAME[l]).join('、')}
        </p>
      )}
    </Block>
  );
}

// ---------- 阵容构成 ----------

function FeaturesBlock({ s, tagName }: { s: ReturnType<typeof summarize>; tagName: (id: string) => string }) {
  const f = s.features;
  return (
    <Block title="阵容构成" how="以下各项只按官方职业和已核实的机制标签判定，是“有没有”的计数，不是评分。">
      {s.gaps.length > 0 && (
        <ul className="mb-2 space-y-1">
          {s.gaps.map((g, i) => (
            <li key={i} className={`rounded-md px-2.5 py-1.5 text-[12.5px] ${g.tone === 'bad' ? 'bg-bad/10 text-bad' : 'bg-warn/10 text-warn'}`}>
              缺口：{g.text}
            </li>
          ))}
        </ul>
      )}
      {f.unknown > 0 && (
        <Note tone="warn" className="mb-2">
          有{f.unknown}个英雄的机制档案不可用（{s.unknownHeroes.map((h) => `${h.name}：${PROFILE_STATE(h) ?? '不可用'}`).join('；')}），硬控、范围硬控、先手开团、保护、清线几项按“未知”处理，计数可能偏低。
        </Note>
      )}
      <div className="overflow-hidden rounded-md border border-line">
        <table className="w-full text-[12.5px]">
          <tbody>
            <tr className="border-b border-line align-top">
              <th className="w-[84px] bg-panel2/60 px-2.5 py-2 text-left font-medium text-sub">伤害构成</th>
              <td className="px-2.5 py-2">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {(['physical', 'magic', 'mixed'] as const).map((k) => (
                    <span key={k} className="inline-flex items-center gap-1.5">
                      <span className="text-sub">
                        {DAMAGE_NAME[k]}
                        <b className="ml-0.5 text-ink">{s.damage[k].length}</b>
                      </span>
                      {s.damage[k].map((h) => (
                        <HeroAvatar key={h.id} hero={h} size={18} />
                      ))}
                    </span>
                  ))}
                </div>
                <p className="mt-1 text-[11.5px] text-dim">判定：{DAMAGE_HOW}。</p>
              </td>
            </tr>
            {FEATURES.map((def) => {
              const list = s.byFeature[def.key];
              return (
                <tr key={def.key} className="border-b border-line align-top last:border-b-0">
                  <th className="bg-panel2/60 px-2.5 py-2 text-left font-medium text-sub">{def.label}</th>
                  <td className="px-2.5 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <b className={list.length ? 'text-ink' : 'text-mute'}>{list.length}</b>
                      {list.map((h) => (
                        <MiniHero key={h.id} hero={h} size={18} />
                      ))}
                      {def.needsProfile && f.unknown > 0 && <span className="text-[11.5px] text-warn">另有{f.unknown}人未知</span>}
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-dim">判定：{def.how(tagName)}</p>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {s.missingOther.length > 0 && <p className="mt-2 text-[12px] text-mute">计数为0的其他项：{s.missingOther.join('、')}。</p>}
    </Block>
  );
}

// ---------- 战术体系 ----------

function ArchetypeBlock({ s }: { s: ReturnType<typeof summarize> }) {
  return (
    <Block title="战术体系" how="按体系定义中的判定条件（官方职业与已核实机制标签）匹配。体系说明是通用的战术描述，不是数据结论，也不代表强度。">
      {s.matches.length === 0 ? (
        <Note>没有命中已定义的体系。</Note>
      ) : (
        <div className="space-y-3">
          {s.matches.map((m) => (
            <div key={m.archetype.id} className="rounded-lg border border-line bg-panel2/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/comps?tab=archetypes&arch=${m.archetype.id}`} className="text-[14px] font-semibold text-ink hover:text-blue">
                  {m.archetype.name}
                </Link>
                <span className="text-[12px] text-mute">核心英雄</span>
                {m.cores.map((h) => (
                  <MiniHero key={h.id} hero={h} size={18} />
                ))}
              </div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-sub">{m.archetype.description}</p>
              <ul className="mt-2 space-y-1">
                {m.detail.map((d, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 text-[12px]">
                    <span className="chip">
                      {d.label} · 需要{d.count}人 · 满足{d.heroes.length}人
                    </span>
                    {d.heroes.map((h) => (
                      <MiniHero key={h.id} hero={h} size={16} />
                    ))}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12.5px] leading-relaxed">
                <span className="mr-1 font-medium text-sub">Win Condition</span>
                <span className="text-sub">{m.archetype.winCondition}</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </Block>
  );
}

function WeakToRow({ label, heroes }: { label: string; heroes: HeroData[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[12.5px] text-bad">{label}</span>
        <Toggle open={open} onClick={() => setOpen(!open)}>
          符合条件的英雄{heroes.length}个
        </Toggle>
      </div>
      {open && (
        <div className="mt-1 pl-2">
          <HeroChips heroes={heroes} limit={16} size={18} />
        </div>
      )}
    </div>
  );
}

// ---------- 队内协同 ----------

function SynergyBlock({ heroes, getSynergy }: { heroes: HeroData[]; getSynergy: (a: number, b: number) => Relation | undefined }) {
  const [all, setAll] = useState(false);
  const pairs: { a: HeroData; b: HeroData; r: Relation }[] = [];
  let total = 0;
  for (let i = 0; i < heroes.length; i++)
    for (let j = i + 1; j < heroes.length; j++) {
      total++;
      const r = getSynergy(heroes[i].id, heroes[j].id);
      if (r && (r.evidence.length || r.doubtful.length)) pairs.push({ a: heroes[i], b: heroes[j], r });
    }
  pairs.sort((x, y) => y.r.weight - x.r.weight);
  const shown = all ? pairs : pairs.slice(0, 6);
  return (
    <Block title="队内协同" how="英雄两两之间的配合关系，按计分权重降序。权重是证据计分（官方说明、机制推导、职业赛同队共现、解说），不是胜率。">
      {total === 0 ? (
        <Note>至少需要2个英雄。</Note>
      ) : pairs.length === 0 ? (
        <Note>暂无结论：阵容内{total}对英雄之间都没有记录的配合关系。</Note>
      ) : (
        <div className="space-y-1.5">
          {shown.map((p) => (
            <PairRow key={`${p.a.id}-${p.b.id}`} a={p.a} b={p.b} r={p.r} verb="配合" verbCls="text-good" />
          ))}
          {pairs.length > 6 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll(!all)}>
              {all ? '收起' : `显示全部${pairs.length}对`}
            </button>
          )}
          {total - pairs.length > 0 && <p className="text-[12px] text-mute">其余{total - pairs.length}对暂无结论。</p>}
        </div>
      )}
    </Block>
  );
}

function PairRow({ a, b, r, verb, verbCls, value }: { a: HeroData; b: HeroData; r: Relation; verb: string; verbCls: string; value?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-line bg-panel2/40">
      <button type="button" className="flex w-full flex-wrap items-center gap-2 px-2.5 py-1.5 text-left hover:bg-panel2" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={`inline-block text-mute transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
        <span className="inline-flex items-center gap-1 text-[12.5px]">
          <HeroAvatar hero={a} size={20} />
          {a.name}
        </span>
        <span className={`text-[12px] ${verbCls}`}>{verb}</span>
        <span className="inline-flex items-center gap-1 text-[12.5px]">
          <HeroAvatar hero={b} size={20} />
          {b.name}
        </span>
        <KindBadges relation={r} />
        <span className="ml-auto text-[12px] text-mute">
          {value ?? (r.weight === 0 ? <span className="text-warn">只有存疑证据，不计分</span> : <>权重 {r.weight.toFixed(2)}</>)}
        </span>
      </button>
      {open && (
        <div className="border-t border-line px-3 py-2.5">
          <EvidenceList relation={r} />
        </div>
      )}
    </div>
  );
}

// ---------- 被克点 ----------

function ThreatBlock({ s, pool, tagName }: { s: ReturnType<typeof summarize>; pool: HeroData[]; tagName: (id: string) => string }) {
  const { rel } = useEngine();
  const heroes = s.heroes;
  const threats = useMemo(() => teamThreats(heroes, pool, rel, 8), [heroes, pool, rel]);
  const weak = s.matches.filter((m) => m.archetype.weakTo.length > 0);
  return (
    <Block title="被克点" how="对每个不在阵容里的非限时英雄，累加它对阵容中各英雄的净克制权重（它克制对方的权重减去被对方克制的权重，只计为正的对象），列出合计最高的几位。权重是证据计分，不是胜率。">
      {threats.length === 0 ? (
        <Note>暂无结论：没有英雄对这套阵容有已核实的净克制关系。</Note>
      ) : (
        <div className="space-y-1.5">
          {threats.map((t) => (
            <ThreatRow key={t.hero.id} hero={t.hero} weight={t.weight} targets={t.targets} />
          ))}
        </div>
      )}
      {weak.length > 0 && (
        <div className="mt-3 space-y-2 rounded-md border border-line bg-panel2/40 px-3 py-2.5">
          <div className="text-[12.5px] font-medium text-sub">命中体系通常怕什么</div>
          <p className="text-[11.5px] text-dim">条件来自体系定义（通用描述，不是数据结论）；按已核实机制标签列出符合条件的非限时英雄，不代表一定克制。</p>
          {weak.map((m) => (
            <div key={m.archetype.id} className="space-y-1">
              <div className="text-[12px] text-mute">{m.archetype.name}</div>
              {m.archetype.weakTo.map((w, i) => (
                <WeakToRow key={i} label={w.label} heroes={heroesMatching(pool, w.cond, tagName)} />
              ))}
            </div>
          ))}
        </div>
      )}
    </Block>
  );
}

function ThreatRow({ hero, weight, targets }: { hero: HeroData; weight: number; targets: HeroData[] }) {
  const { rel } = useEngine();
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-line bg-panel2/40">
      <div className="flex flex-wrap items-center gap-2 px-2.5 py-1.5">
        <MiniHero hero={hero} size={24} />
        {hero.isLimited && <LimitedChip />}
        <span className="text-[12px] text-bad">克制</span>
        {targets.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1 text-[12px] text-sub">
            <HeroAvatar hero={t} size={18} />
            {t.name}
            <span className="text-dim">{rel.net(hero.id, t.id).toFixed(2)}</span>
          </span>
        ))}
        <span className="ml-auto text-[12px] text-mute">净克制权重合计 {weight}</span>
        <Toggle open={open} onClick={() => setOpen(!open)}>
          证据
        </Toggle>
      </div>
      {open && (
        <div className="space-y-2 border-t border-line px-3 py-2.5">
          {targets.map((t) => {
            const r = rel.getCounter(hero.id, t.id);
            const back = rel.getCounter(t.id, hero.id);
            return (
              <div key={t.id} className="space-y-2">
                {r && <RelationCard relation={r} />}
                {back && back.weight > 0 && (
                  <div>
                    <p className="mb-1 text-[12px] text-mute">反向关系（已从净权重中扣除）：</p>
                    <RelationCard relation={back} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- 替代英雄 ----------

function SubstituteBlock({ s, pool, tagName }: { s: ReturnType<typeof summarize>; pool: HeroData[]; tagName: (id: string) => string }) {
  return (
    <Block title="替代英雄" how="按同分路、已核实机制标签的重合度计算：共有标签数÷双方标签并集数，伤害类型不同时再乘0.8；只列相似度≥0.3、非限时且该分路为常规分路的英雄。相似度不代表强弱。">
      <div className="space-y-2">
        {s.lanes.map((r) => {
          const subs = substitutes(r.hero, pool, r.lane, 3);
          const state = PROFILE_STATE(r.hero);
          return (
            <div key={r.hero.id} className="flex gap-3 rounded-md border border-line bg-panel2/40 px-2.5 py-2">
              <div className="flex w-[116px] shrink-0 items-center gap-1.5">
                <LaneBadge lane={r.lane} />
                <MiniHero hero={r.hero} size={20} />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                {state ? (
                  <span className="text-[12px] text-warn">{state}，无法计算</span>
                ) : subs.length === 0 ? (
                  <span className="text-[12px] text-mute">没有足够相似的替代</span>
                ) : (
                  subs.map((x) => (
                    <div key={x.hero.id} className="flex flex-wrap items-center gap-1.5">
                      <MiniHero hero={x.hero} size={20} />
                      <span className="text-[11.5px] text-mute">相似度 {x.similarity.toFixed(2)}</span>
                      {x.shared.map((t) => (
                        <span key={t} className="chip !h-[18px] !text-[11px]">
                          {tagName(t)}
                        </span>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Block>
  );
}
