// 各分路梯度：路人局用王者营地英雄榜（各位置热度前10），职业赛用禁选数据计算；都随数据更新自动变化。
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LANES, LANE_NAME, type CampEntry, type CampSegment, type HeroData, type Lane } from '../types.ts';
import { fmtDate, useEngine } from '../lib/data.ts';
import { TIER_MIN, TIER_NAME, laneTiers, type TierRow } from '../engine/tiers.ts';
import { Empty, HeroAvatar } from '../components/ui.tsx';

const TIER_STYLE = ['border-gold/60 bg-gold/10 text-gold', 'border-blue/50 bg-blue/10 text-blue', 'border-line2 bg-panel2 text-sub', 'border-line bg-panel2/50 text-mute'];
const pct = (x: number) => `${Math.round(x * 100)}%`;

function Row({ r, patch }: { r: TierRow; patch?: 'buff' | 'nerf' }) {
  return (
    <Link
      to={`/heroes/${r.hero.id}`}
      className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-panel3"
      title={`第一局在${LANE_NAME[r.lane]}被选${r.picks}次；被禁${r.bans}次，按它打这个位置的比例计入${r.bansHere.toFixed(1)}次；近60天在这个位置出场${r.recent}次`}
    >
      <HeroAvatar hero={r.hero} size={30} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
        {r.hero.name}
        {patch && <span className={`ml-1 text-[11px] ${patch === 'buff' ? 'text-good' : 'text-bad'}`} title={`近45天官方公告：${patch === 'buff' ? '增强' : '削弱'}`}>{patch === 'buff' ? '↑' : '↓'}</span>}
      </span>
      <span className="shrink-0 text-right text-[11.5px] leading-tight text-mute">
        <span className="text-[12.5px] font-medium text-sub">{pct(r.presence)}</span>
        <br />
        选{r.picks} 禁{r.bans}
      </span>
    </Link>
  );
}

const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;
const tierNum = (t: string) => Number(t.replace(/\D/g, '')) || 0;

/** 营地榜单里的一行：档位变化与上一份数据比较 */
function CampRow({ e, hero, patch, prevDate }: { e: CampEntry; hero: HeroData; patch?: 'buff' | 'nerf'; prevDate: string | null }) {
  const move = e.prev === undefined || !prevDate ? null : e.prev === null ? 'new' : tierNum(e.prev) > tierNum(e.tier) ? 'up' : tierNum(e.prev) < tierNum(e.tier) ? 'down' : null;
  return (
    <Link to={`/heroes/${hero.id}`} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-panel3" title={`胜率 ${pct1(e.win)}，登场率 ${pct1(e.show)}，禁用率 ${pct1(e.ban)}（该英雄在这个段位的整体数字，不区分位置）`}>
      <HeroAvatar hero={hero} size={30} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
        {hero.name}
        {move === 'new' && <span className="ml-1 rounded bg-good/15 px-1 text-[10.5px] text-good" title={`${prevDate} 的数据里不在前10`}>新进</span>}
        {move === 'up' && <span className="ml-1 text-[11px] text-good" title={`${prevDate} 是 ${e.prev}`}>▲</span>}
        {move === 'down' && <span className="ml-1 text-[11px] text-bad" title={`${prevDate} 是 ${e.prev}`}>▼</span>}
        {patch && <span className={`ml-1 text-[11px] ${patch === 'buff' ? 'text-good' : 'text-bad'}`} title={`近45天官方公告：${patch === 'buff' ? '增强' : '削弱'}`}>{patch === 'buff' ? '↑' : '↓'}</span>}
      </span>
      <span className="shrink-0 text-right text-[11.5px] leading-tight text-mute">
        <span className={`text-[12.5px] font-medium ${e.win >= 0.52 ? 'text-good' : e.win < 0.48 ? 'text-bad' : 'text-sub'}`}>胜率 {pct1(e.win)}</span>
        <br />
        登场 {Math.round(e.show * 100)}% 禁 {Math.round(e.ban * 100)}%
      </span>
    </Link>
  );
}

function CampGrid({ seg, patched, prevDate }: { seg: CampSegment; patched: Map<number, 'buff' | 'nerf'>; prevDate: string | null }) {
  const { byId } = useEngine();
  return (
    <div className="grid grid-cols-5 gap-3">
      {LANES.map((lane: Lane) => {
        const list = seg.lanes[lane].filter((e) => byId.has(e.id));
        const names = [...new Set(list.map((e) => e.tier))].sort((a, b) => tierNum(a) - tierNum(b));
        return (
          <section key={lane} className="panel p-3" data-lane={lane}>
            <h2 className="mb-2 border-b border-line pb-2 text-[14px] font-semibold text-ink">
              {LANE_NAME[lane]}
              <span className="ml-2 text-[11.5px] font-normal text-dim">热度前 {list.length}</span>
            </h2>
            {list.length === 0 && <p className="px-1.5 text-[12px] text-dim">没有数据</p>}
            {names.map((name) => (
              <div key={name} className="mb-2.5">
                <div className={`mb-1 inline-flex h-[20px] items-center rounded border px-1.5 text-[11.5px] font-semibold ${TIER_STYLE[Math.min(tierNum(name), TIER_STYLE.length - 1)]}`}>{name}</div>
                {list.filter((e) => e.tier === name).map((e) => <CampRow key={e.id} e={e} hero={byId.get(e.id)!} patch={patched.get(e.id)} prevDate={prevDate} />)}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

export function TiersPage() {
  const { bundle } = useEngine();
  const [params, setParams] = useSearchParams();
  const tiers = useMemo(() => laneTiers(bundle), [bundle]);
  // 近45天官方公告里标题写明增强/削弱的英雄
  const patched = useMemo(() => {
    const cutoff = new Date(new Date(bundle.meta.generatedAt).getTime() - 45 * 86400_000).toISOString().slice(0, 10);
    const m = new Map<number, 'buff' | 'nerf'>();
    for (const p of bundle.patches) {
      if (p.date < cutoff) break;
      for (const h of p.heroes) if (h.direction !== 'adjust' && !m.has(h.id)) m.set(h.id, h.direction);
    }
    return m;
  }, [bundle]);
  const heat = bundle.kpl?.heat.recent;
  const camp = bundle.camp;
  // 来源：营地的某个段位（s3、s4、s1），或职业赛（kpl）。默认看巅峰赛
  const sources = [...(camp?.segments ?? []).map((s) => ({ key: `s${s.id}`, label: s.name })), { key: 'kpl', label: '职业赛（KPL）' }];
  const src = sources.some((s) => s.key === params.get('src')) ? params.get('src')! : sources[0].key;
  const seg = camp?.segments.find((s) => `s${s.id}` === src);
  const campAge = camp ? Math.floor((Date.now() - new Date(`${camp.updateTime}T00:00:00+08:00`).getTime()) / 86400_000) : 0;

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4">
      <div className="panel p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-[17px] font-semibold text-ink">各分路梯度</h1>
          <div className="flex flex-wrap items-center gap-1.5" role="tablist">
            {camp && <span className="text-[12px] text-dim">路人局</span>}
            {sources.map((s) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={s.key === src}
                data-src={s.key}
                onClick={() => setParams(s.key === sources[0].key ? {} : { src: s.key }, { replace: true })}
                className={`h-[28px] rounded-md border px-2.5 text-[12.5px] ${s.key === src ? 'border-blue bg-blue/15 text-ink' : 'border-line bg-panel2 text-sub hover:text-ink'} ${s.key === 'kpl' && camp ? 'ml-2' : ''}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <span className="text-[12px] text-mute">
            {seg && camp ? `王者营地英雄榜，数据日期 ${fmtDate(camp.updateTime)}${camp.prevUpdateTime ? `，▲▼ 是与 ${fmtDate(camp.prevUpdateTime)} 相比` : ''}` : heat ? `统计 ${fmtDate(heat.from)} 至 ${fmtDate(heat.to)} 的 ${heat.games} 个系列赛第一局` : ''}
          </span>
        </div>
        {seg && camp ? (
          <div className="mt-2.5 rounded-md border border-line2 bg-panel2 px-3 py-2 text-[12.5px] leading-relaxed text-sub" data-testid="tiers-note">
            <b className="text-ink">这是路人局（{seg.name}）的数据，来自王者营地。</b>
            营地的公开页面每个位置只列出热度最高的 {camp.limit} 个英雄，所以每路最多 {camp.limit} 个，完整榜单要在营地App里看。
            T0、T1、T2 是营地自己标的热度档位（看登场和禁用，不是按胜率排），本站原样显示。
            胜率、登场率、禁用率是这个英雄在该段位的整体数字，不区分位置。
            {campAge > 7 && <b className="ml-1 text-warn">这份数据已经是 {campAge} 天前的，可能过期。</b>}
            <a href={camp.url} target="_blank" rel="noreferrer noopener" className="ml-1 text-blue hover:underline">营地英雄榜 ↗</a>
          </div>
        ) : (
          <div className="mt-2.5 rounded-md border border-gold/50 bg-gold/10 px-3 py-2 text-[12.5px] leading-relaxed text-ink" data-testid="tiers-note">
            <b className="text-gold">这是职业赛的优先级，不是路人局强度。</b>
            出场率 =（第一局里在该位置被选的次数 + 第一局被禁次数 × 它打这个位置的比例）÷ 第一局总局数。
            只用每个系列赛的第一局，是因为之后几局本队用过的英雄不能再用，不能反映优先级。
            档位：{TIER_NAME.map((t, i) => `${t} ≥ ${pct(TIER_MIN[i])}`).join('，')}；低于 {pct(TIER_MIN[TIER_MIN.length - 1])} 不列出。
          </div>
        )}
      </div>

      {seg && camp ? (
        <CampGrid seg={seg} patched={patched} prevDate={camp.prevUpdateTime} />
      ) : !tiers ? (
        <Empty>职业赛数据不足，无法计算梯度。</Empty>
      ) : (
        <div className="grid grid-cols-5 gap-3">
          {LANES.map((lane: Lane) => (
            <section key={lane} className="panel p-3" data-lane={lane}>
              <h2 className="mb-2 border-b border-line pb-2 text-[14px] font-semibold text-ink">
                {LANE_NAME[lane]}
                <span className="ml-2 text-[11.5px] font-normal text-dim">{tiers.rows[lane].length} 个英雄</span>
              </h2>
              {TIER_NAME.map((name, t) => {
                const list = tiers.rows[lane].filter((r) => r.tier === t);
                return (
                  <div key={name} className="mb-2.5">
                    <div className={`mb-1 inline-flex h-[20px] items-center rounded border px-1.5 text-[11.5px] font-semibold ${TIER_STYLE[t]}`}>{name}</div>
                    {list.length === 0 ? <p className="px-1.5 text-[12px] text-dim">无</p> : list.map((r) => <Row key={r.hero.id} r={r} patch={patched.get(r.hero.id)} />)}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
