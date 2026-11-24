import { useMemo, type ReactNode } from 'react';
import { useEngine, fmtDate, freshness } from '../lib/data.ts';
import { Empty } from '../components/ui.tsx';
import { W } from '../engine/relations.ts';
import { COMP_FLOORS, FLOOR_POINTS } from '../engine/comp.ts';
import { DEFAULT_WEIGHTS as DW, PART_NAME, type PartKey } from '../engine/recommend.ts';
import { LANING_POINTS, laneView } from '../engine/laning.ts';
import { LANE_NAME, type BacktestMethod, type Lane, type LaneAspect } from '../types.ts';

const TOC = [
  ['update', '更新状态'], ['sources', '数据来源'], ['counts', '数量一览'], ['profile', '机制档案核实'], ['scoring', '证据等级与计分'],
  ['rules', '规则表'], ['model', '选人模型'], ['laning', '对线强弱'], ['backtest', '回测'], ['outcome', '胜负检验'], ['pending', '待复核清单'], ['limits', '已知限制'], ['copyright', '版权声明'],
] as const;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const n = (x: number | undefined) => (x ?? 0).toLocaleString('zh-CN');

function Sec({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="panel scroll-mt-4 p-4">
      <h2 className="panel-title mb-3">{title}</h2>
      <div className="flex flex-col gap-3 text-[13px] leading-relaxed text-sub">{children}</div>
    </section>
  );
}
const Th = ({ children }: { children: ReactNode }) => <th className="border-b border-line px-2 py-1.5 text-left text-[12px] font-medium text-mute">{children}</th>;
const Td = ({ children, className = '' }: { children: ReactNode; className?: string }) => <td className={`border-b border-line/50 px-2 py-1.5 align-top ${className}`}>{children}</td>;
const Stat = ({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) => (
  <div className="rounded-lg bg-panel2 p-3" title={hint}>
    <div className="text-[20px] font-semibold text-ink">{value}</div>
    <div className="text-[12px] text-mute">{label}</div>
  </div>
);

export function AboutPage() {
  const engine = useEngine();
  const { bundle, rel, laning } = engine;
  const { meta } = bundle;
  const c = meta.counts;
  const fr = freshness(meta.generatedAt);
  const pr = meta.profileReport;
  const bt = meta.backtest;

  const ruleHits = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rel.all) for (const e of r.evidence) if (e.kind === 'rule') m.set(e.rule.id, (m.get(e.rule.id) ?? 0) + 1);
    return m;
  }, [rel]);

  // 对线说法的覆盖面：各路常用英雄（适配权重≥0.3，不含限时英雄）里，有可用说法的有多少
  const laneCoverage = useMemo(() => {
    const rows: { lane: Lane; label: string; aspects: LaneAspect[] }[] = [
      { lane: 1, label: '对线强弱', aspects: ['lane', 'early'] },
      { lane: 3, label: '对线强弱', aspects: ['lane', 'early'] },
      { lane: 3, label: '清线抢线', aspects: ['clear'] },
      { lane: 4, label: '对线强弱', aspects: ['duo', 'lane', 'early'] },
      { lane: 5, label: '清线抢线', aspects: ['clear'] },
      { lane: 5, label: '双人对线', aspects: ['duo', 'lane'] },
    ];
    return rows.map((r) => {
      const hs = bundle.heroes.filter((h) => !h.isLimited && h.lanes[r.lane - 1] >= 0.3);
      const levels = hs.map((h) => r.aspects.map((a) => laneView(laning, h.id, a, r.lane)).find((v) => v)?.level);
      return { ...r, total: hs.length, known: levels.filter((l) => l && l !== 'mixed').length, mixed: levels.filter((l) => l === 'mixed').length };
    });
  }, [bundle, laning]);

  const parts: { key: PartKey; desc: string }[] = [
    { key: 'counter', desc: `候选克制对方已选英雄时加分，被对方克制时扣分：每条关系按它的证据权重 × ${DW.counterPerUnit} 分，同路对线再 × ${DW.counterSameLane}；合计不超过 ±${DW.counterCap}` },
    { key: 'synergy', desc: `与己方已选英雄有配合关系时加分：每条关系按证据权重 × ${DW.synergyPerUnit} 分；合计不超过 ${DW.synergyCap}` },
    { key: 'needs', desc: `阵容底线：从第三手起，看候选能否补上本方的缺口（硬控、坦克或战士、法术伤害、物理伤害为硬性底线；第二个硬控、第二个坦克或战士、范围硬控、先手开团、清线为“最好有”）。能补的加分，越接近选完加得越多；选了之后已经不可能达到的扣分；合计不超过 ±${DW.needsCap}` },
    { key: 'laning', desc: `对线强弱：教学视频里解说对候选“清线抢线快慢、对线强弱、双人对线强弱”的明确说法。和对面同路英雄的强弱差每档 ${LANING_POINTS.perStep} 分；解说点名说它对某个对手占优或吃亏时 ±${LANING_POINTS.direct} 分；对面这一路还没人时按它自己的说法 ±${LANING_POINTS.alone} 分；合计不超过 ±${DW.laningCap}。没有说法的英雄这一项为0` },
    { key: 'lane', desc: `按候选在己方空缺分路上的适配度（0–1）计分，范围约 ±${DW.laneFit / 2}；己方剩下的分路都不是它的常规位置时为 ${DW.laneMiss}` },
    { key: 'meta', desc: `职业赛第一局的出场率（被选次数+被禁次数）÷ 局数 × ${DW.metaRange}，只加分不扣分；最近45天内官方公告标题写明“增强/削弱”的英雄另计 ±${DW.patch}` },
    { key: 'exposure', desc: `对方还有选人机会时，按“还没被禁、又克制它”的英雄的证据权重扣分，对方剩余手数越多扣得越多；最多扣 ${DW.exposureCap}` },
    { key: 'proVs', desc: `职业赛近一年：对面先亮出某英雄之后，候选被选的实际次数与“按它平均被选概率预计的次数”之比，取对数 × ${DW.proPerUnit}；合计不超过 ±${DW.proCap}。这是职业队的选人行为，不是胜负，也不等于机制上的克制` },
    { key: 'proAlly', desc: `同上，但看的是队友先选了某英雄之后候选被选的情况；合计不超过 ±${DW.proCap}` },
    { key: 'lanePick', desc: `职业赛近一年候选在这个位置的出场次数 ÷ 队伍场次 × ${DW.lanePickRange}，只加分不扣分` },
    { key: 'lanePickRecent', desc: `同上，但只看近60天，更贴近当前版本；近60天不足40个队伍场次时不计` },
    { key: 'banPri', desc: `职业赛第一局被禁次数 ÷ 局数 × ${DW.banRange}：经常被禁的英雄放出来时值得优先考虑` },
    { key: 'pool', desc: `只在“我的英雄池”模式下计算：熟练度每高一级 +${DW.poolPerLevel}` },
  ];


  const LaneRows = ({ ms }: { ms: BacktestMethod[] }) => (
    <>
      {ms.map((m) => (
        <tr key={m.id}>
          <Td>{m.name}</Td>
          <Td>{pct(m.top1 ?? 0)}</Td>
          <Td>{pct(m.top3 ?? 0)}</Td>
          <Td>{pct(m.top5)}</Td>
          <Td>{m.mrr.toFixed(3)}</Td>
        </tr>
      ))}
    </>
  );

  const MethodRows = ({ ms, adopted }: { ms: BacktestMethod[]; adopted?: string }) => (
    <>
      {ms.map((m) => (
        <tr key={m.id} className={m.id === adopted ? 'bg-gold/10' : ''}>
          <Td>{m.name}{m.id === adopted && <span className="ml-1.5 text-[11px] text-gold">采用</span>}</Td>
          <Td>{pct(m.top5)}（{m.top5.toFixed(3)}）</Td>
          <Td>{pct(m.top10)}（{m.top10.toFixed(3)}）</Td>
          <Td>{m.mrr.toFixed(3)}</Td>
        </tr>
      ))}
    </>
  );

  return (
    <div className="flex items-start gap-5">
      <nav className="sticky top-4 w-40 shrink-0 text-[13px]" aria-label="页内目录">
        <div className="mb-2 text-[12px] text-mute">本页目录</div>
        <ul className="flex flex-col gap-0.5">
          {TOC.map(([id, t]) => (
            <li key={id}><a href={`#about-${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`about-${id}`)?.scrollIntoView({ behavior: 'smooth' }); }} className="block rounded px-2 py-1 text-sub hover:bg-panel2 hover:text-ink">{t}</a></li>
          ))}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Sec id="about-update" title="更新状态">
          {fr.level !== 'fresh' && (
            <div className={`rounded-md px-3 py-2 ${fr.level === 'old' ? 'bg-bad/15 text-bad' : 'bg-warn/15 text-warn'}`}>
              {fr.level === 'old' ? `数据包已生成 ${fr.days} 天，超过30天，内容可能明显落后，请尽快更新。` : `数据包已生成 ${fr.days} 天，超过14天，建议更新。`}
            </div>
          )}
          {fr.level === 'fresh' && <div className="rounded-md bg-good/15 px-3 py-2 text-good">数据包生成于 {fr.days} 天前，在14天以内。</div>}
          <div className="grid grid-cols-5 gap-2">
            <Stat label="数据包生成时间" value={fmtDate(meta.generatedAt)} />
            <Stat label="官方资料抓取时间" value={fmtDate(meta.officialFetchedAt)} />
            <Stat label="公告抓取时间" value={fmtDate(meta.newsFetchedAt)} />
            <Stat label="当前赛季" value={meta.season ?? '未知'} />
            <Stat label="最近版本更新公告" value={fmtDate(meta.latestPatchDate)} />
          </div>
          <p>更新方式：在项目目录运行 <span className="kbd">npm run update-data</span>，然后重新构建发布。</p>
        </Sec>

        <Sec id="about-sources" title="数据来源">
          <table className="w-full text-[13px]">
            <thead><tr><Th>数据</Th><Th>来源</Th><Th>用途</Th><Th>是否参与计分</Th></tr></thead>
            <tbody>
              <tr><Td>英雄资料与官方关系</Td><Td>王者荣耀官网英雄详情页（pvp.qq.com）</Td><Td>英雄、技能原文、官方给出的克制与配合说明</Td><Td>参与（官方证据）；技能原文用于机制推导</Td></tr>
              <tr><Td>版本公告</Td><Td>官网公告接口</Td><Td>在英雄页展示逐条改动；标题写明“增强/削弱”的英雄在推荐分里小幅加减</Td><Td>参与（仅标题写明方向的改动，幅度很小）</Td></tr>
              <tr><Td>职业赛BP</Td><Td>腾讯官方赛事数据中心，{bundle.kpl ? <>覆盖 {fmtDate(bundle.kpl.coverage.from)} 至 {fmtDate(bundle.kpl.coverage.to)}，抓取 {n(bundle.kpl.coverage.battlesFetched)} 局、可用 {n(bundle.kpl.coverage.battlesUsable)} 局</> : '尚未收录'}</Td><Td>禁选次数、选手分路、同队共现</Td><Td>参与（职业赛证据，有上限）；不计算胜率</Td></tr>
              <tr><Td>路人局英雄榜</Td><Td>王者营地英雄榜的公开分享页{bundle.camp ? `，数据日期 ${fmtDate(bundle.camp.updateTime)}` : '（尚未收录）'}</Td><Td>各位置热度前10的档位、胜率、登场率、禁用率，用于“分路梯度”页和英雄页</Td><Td>不参与</Td></tr>
              <tr><Td>对线说法</Td><Td>B站教学视频的字幕{bundle.laning ? `：读了 ${n(bundle.laning.scope.heroVideos)} 个按英雄的教学视频和 ${n(bundle.laning.scope.topicVideos)} 个讲对线的专题视频，引用了其中 ${n(Object.keys(bundle.laning.videos).length)} 个` : '（尚未收录）'}</Td><Td>解说明确说过的“清线抢线快慢、对线强弱、双人对线强弱、前期强弱”，用于对线判断和英雄页</Td><Td>{bundle.laning ? `参与（“对线强弱”分项，上限 ±${DW.laningCap}）` : '尚未收录'}</Td></tr>
              <tr><Td>解说视频</Td><Td>B站</Td><Td>解说条目作为补充证据{(c.commentary ?? 0) > 0 ? `，已收录 ${n(c.commentary)} 条` : ''}</Td><Td>{(c.commentary ?? 0) > 0 ? '参与（权重最低档）' : '尚未收录'}</Td></tr>
            </tbody>
          </table>
        </Sec>

        <Sec id="about-counts" title="数量一览">
          <div className="grid grid-cols-5 gap-2">
            <Stat label="英雄数" value={n(c.heroes)} />
            <Stat label="限时英雄数" value={n(c.limitedHeroes)} />
            <Stat label="技能数" value={n(c.skills)} />
            <Stat label="官方关系边" value={n(c.officialEdges)} />
            <Stat label="规则条数" value={n(c.rules)} />
            <Stat label="打法条目" value={n(c.playbook)} />
            <Stat label="计分关系总数" value={n(c.relationsScored)} />
            <Stat label="其中克制" value={n(c.counterRelations)} />
            <Stat label="其中配合" value={n(c.synergyRelations)} />
            <Stat label="含官方证据的关系" value={n(c.withOfficial)} />
            <Stat label="含机制证据的关系" value={n(c.withRule)} />
            <Stat label="含职业赛证据的关系" value={n(c.withKpl)} />
            <Stat label="英雄对覆盖率" value={`${c.pairCoveragePct ?? 0}%`} hint="pairCoveragePct" />
            <Stat label="职业赛可用对局数" value={n(c.kplBattles)} />
          </div>
          <p>英雄对覆盖率：有至少一条计分关系的英雄对占全部英雄对的比例。其余英雄对没有结论，推荐时不会假设它们之间有克制或配合。</p>
        </Sec>

        <Sec id="about-profile" title="机制档案的核实情况">
          {pr ? (
            <div className="grid grid-cols-6 gap-2">
              <Stat label="已盲审英雄" value={`${n(pr.reviewed)}/${n(pr.heroes)}`} />
              <Stat label="标签一致率" value={pr.tagAgreement == null ? '未计算' : pct(pr.tagAgreement)} />
              <Stat label="已核实标签" value={n(pr.tagsVerified)} />
              <Stat label="存疑标签" value={n(pr.tagsDisputed)} />
              <Stat label="保留的说明文字" value={n(pr.proseOk)} />
              <Stat label="丢弃的说明文字" value={n(pr.proseDropped)} />
            </div>
          ) : <Empty>尚无机制档案核实报告。</Empty>}
          <p>流程：一个模型只根据官方技能原文提取带原文引用的机制标签，脚本逐字校验引用；另一个模型独立再标一遍；两边一致才算已核实，不一致的由第三方按原文裁定，仍不成立的记为存疑且不参与计分。</p>
        </Sec>

        <Sec id="about-scoring" title="证据等级与计分">
          <div className="rounded-md border border-gold/50 bg-gold/10 px-3 py-2.5 text-ink">
            <b className="text-gold">推荐分不是胜率。</b>它是各分项按系数加总后的排序依据；系数由职业赛BP训练得到（见下方“选人模型”），不是任何对局的获胜概率。<b className="text-gold">可信程度</b>表示该候选与多少个已选英雄之间存在已核实关系：关联越多，分数背后的依据越多；没有关联时分数主要来自位置、阵容需求等其他分项。
          </div>
          <table className="w-full max-w-3xl text-[13px]">
            <thead><tr><Th>证据类型</Th><Th>说明</Th><Th>权重</Th></tr></thead>
            <tbody>
              <tr><Td>官方</Td><Td>官方页面写明的关系；双方页面互相印证时加成</Td><Td>{W.official}（互证加 {W.officialCorroborated}）</Td></tr>
              <tr><Td>机制</Td><Td>由双方技能原文按规则推导的倾向，多条规则累加后封顶</Td><Td>单条见规则表，合计上限 {W.ruleCap}</Td></tr>
              <tr><Td>职业赛</Td><Td>职业赛同队共现，只作参考</Td><Td>上限 {W.kplCap}</Td></tr>
              <tr><Td>解说</Td><Td>解说条目</Td><Td>{W.commentary}</Td></tr>
            </tbody>
          </table>
          <p>单个关系的总权重上限为 {W.totalCap}。存疑证据不计分。</p>
          <table className="w-full max-w-3xl text-[13px]">
            <thead><tr><Th>推荐分分项</Th><Th>计算与上限</Th></tr></thead>
            <tbody>{parts.map((p) => <tr key={p.key}><Td className="whitespace-nowrap text-ink">{PART_NAME[p.key]}</Td><Td>{p.desc}</Td></tr>)}</tbody>
          </table>
        </Sec>

        <Sec id="about-rules" title="规则表">
          <table className="w-full text-[13px]">
            <thead><tr><Th>名称</Th><Th>类型</Th><Th>依据的通用机制</Th><Th>成立条件</Th><Th>权重</Th><Th>触发关系数</Th><Th>职业赛胜负检验</Th></tr></thead>
            <tbody>
              {bundle.rules.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap text-ink">{r.name}</Td>
                  <Td><span className={r.type === 'counter' ? 'text-bad' : 'text-good'}>{r.type === 'counter' ? '克制' : '配合'}</span></Td>
                  <Td>{r.basis}</Td><Td>{r.condition}</Td><Td>{r.weight}{r.weightBefore != null && <span className="ml-1 text-[11px] text-dim">原{r.weightBefore}</span>}</Td><Td>{n(ruleHits.get(r.id))}</Td>
                  <Td className="whitespace-nowrap">{r.proCheck ? <>{pct(r.proCheck.winRate)}<span className="ml-1 text-[11px] text-dim">n={r.proCheck.n}，{pct(r.proCheck.lo)}–{pct(r.proCheck.hi)}</span></> : <span className="text-dim">样本不足</span>}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          {bundle.rules.length === 0 && <Empty>没有规则。</Empty>}
          <p className="text-[12.5px]">“职业赛胜负检验”一列：在每局职业赛里数这条规则对双方各成立几次，看成立次数多的一方赢了多少。区间上限低于51%的规则权重减半，区间下限高于50%的规则权重加0.1，其余不变（“原x”是调整前的权重）。大多数规则的区间都跨过50%，说明样本还不足以判断。</p>
        </Sec>

        <Sec id="about-model" title="选人模型">
          {!bundle.model ? <Empty>当前没有采用训练模型，使用手工权重。</Empty> : (
            <>
              <p>
                推荐分 = 50 + Σ（系数 × 分项）。系数来自一个条件logit模型：用职业赛每一手“当时可选的英雄里实际选了谁”来训练，P(选英雄 i) ∝ exp(Σ 系数 × 分项)。
                模型按阶段各拟合一组系数，系数限制为非负。训练数据 {bundle.model.train.from} 至 {bundle.model.train.to}，共 {n(bundle.model.train.picks)} 次选人。
                评估时只用2025年训练、2026年测试（见下方回测）；确认有效后再用全部对局重新拟合，作为线上系数。
              </p>
              <table className="w-full max-w-4xl text-[13px]">
                <thead><tr><Th>分项</Th>{bundle.model.phases.map((p) => <Th key={p.name}>{p.name}</Th>)}</tr></thead>
                <tbody>
                  {bundle.model.features.map((k) => (
                    <tr key={k}>
                      <Td>{PART_NAME[k as PartKey] ?? k}</Td>
                      {bundle.model!.phases.map((p) => <Td key={p.name}>{p.mult[k]?.toFixed(2)}{bundle.model!.floors[k] != null && p.mult[k] === bundle.model!.floors[k] ? <span className="ml-1 text-[11px] text-dim">下限</span> : null}</Td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="rounded-md border border-line bg-panel2 p-3 text-[12.5px] leading-relaxed">
                <b className="text-ink">几处人为设定：</b>
                ①“克制与被克”的系数不低于 {bundle.model.floors.counter}。模型学到的这个系数接近0，意思是机制克制对预测职业队选谁帮助很小；但网站的用途是按对方阵容给建议，所以保留手工权重的力度。
                ②“分路匹配”的系数不低于 {bundle.model.floors.lane}，保证你指定位置时一定生效。
                {bundle.model.floors.needs != null && <>③“阵容底线”的系数不低于 {bundle.model.floors.needs}，原因见下面的“阵容底线”。</>}
                {bundle.model.floors.laning != null && <>④“对线强弱”的系数不低于 {bundle.model.floors.laning}：依据是解说的说法，只覆盖一部分英雄，它是给你的对局建议，不要求能预测职业队选人。</>}
                {' '}这些设定合起来的回测代价见下表“不设系数下限”与“线上使用”两行之差；其中加入“对线强弱”这一项的影响是“上一版模型”与“线上使用”两行之差。
                {bundle.model.lanePhases ? ' 另外，当你设定了“我打某路”时，候选只剩能打这个位置的英雄，这时使用另一组专门拟合的系数（回测里的“指定位置专用系数”）。' : ''}
                <br />
                <b className="text-ink">局限：</b>模型学的是职业队的选择。职业赛是系列赛全局BP、五人配合固定，与单排环境不同；“职业赛针对选择”“职业赛同队选择”反映的是选人习惯，其中一部分只是同一时期都热门。路人局的效果没有数据可以验证。
              </div>
              {bundle.floors && (
                <div id="about-floors">
                  <p>
                    <b className="text-ink">阵容底线。</b>
                    {fmtDate(bundle.floors.from)} 至 {fmtDate(bundle.floors.to)} 的 {n(bundle.floors.teams)} 个职业队阵容几乎都满足下表的条件。但把各位置的常用英雄按出场频率随机拼成阵容，满足的比例几乎一样（“随机对照”一列）：职业队按位置选常用英雄，就自然带齐了前排、控制和两种伤害，职业赛里基本不出现缺口，所以模型从职业赛里学不出“缺什么补什么”的力度。路人局里队友可能选出这样的缺口，因此这一项不靠模型学，按固定分值执行：缺硬性底线时，最后一手能补上的英雄加 {FLOOR_POINTS.must} 分、补不上的扣 {FLOOR_POINTS.must} 分；“最好有”的项目是 {FLOOR_POINTS.should} 分。
                  </p>
                  <table className="w-full text-[13px]">
                    <thead><tr><Th>条件</Th><Th>级别</Th><Th>职业队阵容满足的比例</Th><Th>随机对照</Th></tr></thead>
                    <tbody>
                      {COMP_FLOORS.flatMap((f) =>
                        (['must', 'should'] as const).flatMap((tier) => {
                          const s = bundle.floors!.floors[f.key]?.[tier];
                          return s ? [<tr key={f.key + tier}><Td>至少{s.min}个{f.label}</Td><Td>{tier === 'must' ? '硬性底线' : '最好有'}</Td><Td>{(s.pro * 100).toFixed(1)}%</Td><Td>{(s.shuffled * 100).toFixed(1)}%</Td></tr>] : [];
                        }),
                      )}
                    </tbody>
                  </table>
                  <p className="text-[12px] text-mute">随机对照：每个位置按该位置近一年的出场频率独立抽一个英雄，共4万组。“坦克或战士”按官方主职业（副职业为坦克也算）；硬控、范围硬控、先手开团、清线按已核实的技能标签。</p>
                </div>
              )}
            </>
          )}
        </Sec>

        <Sec id="about-laning" title="对线强弱">
          {!bundle.laning ? <Empty>尚未收录对线说法。</Empty> : (
            <>
              <p>
                三路对线、中辅抢线、射辅对线的判断，依据只有一种：<b className="text-ink">B站教学视频里解说明确说过的话</b>。
                官方职业赛接口只有终局数据，没有前几分钟的经济；官方技能原文也推不出对线胜负；王者营地的对位数据需要登录。所以这里不做任何推算，只整理解说的说法，并且每条都能点开视频对应的时间点核对。
              </p>
              <p>
                流程：一个模型从字幕里提炼说法并给出逐字引用 → 脚本核对引用确实出现在该视频对应时间前后60秒的字幕里 → 另一个模型只看字幕独立复核“解说有没有这么说、方向对不对、是不是在讲对线”。
                共提炼 {n(bundle.laning.scope.extracted)} 条，引用核对通过 {n(bundle.laning.scope.verified)} 条，复核剔除 {n(bundle.laning.scope.reviewDropped)} 条，同一个视频（包括被别的账号转载的同一段内容）对同一件事的重复说法合并后，保留 {n(bundle.laning.claims.length)} 条，涉及 {n(new Set(bundle.laning.claims.map((x) => x.hero)).size)} 个英雄。其中点名了具体对手的 {n(bundle.laning.claims.filter((x) => x.vs != null).length)} 条，点名了搭档的 {n(bundle.laning.claims.filter((x) => x.with != null).length)} 条。
              </p>
              <table className="w-full max-w-3xl text-[13px]">
                <thead><tr><Th>位置</Th><Th>方面</Th><Th>常打这一路的英雄数</Th><Th>有结论</Th><Th>说法不一</Th><Th>没有说法</Th></tr></thead>
                <tbody>
                  {laneCoverage.map((r, i) => (
                    <tr key={i}><Td>{LANE_NAME[r.lane]}</Td><Td>{r.label}</Td><Td>{r.total}</Td><Td>{r.known}（{r.total ? Math.round((r.known / r.total) * 100) : 0}%）</Td><Td>{r.mixed}</Td><Td>{r.total - r.known - r.mixed}</Td></tr>
                  ))}
                </tbody>
              </table>
              <div className="rounded-md bg-panel2 p-3 text-[12px] text-mute">
                <b className="text-sub">列说明：</b>常打这一路的英雄＝该路适配权重不低于0.3的非限时英雄；有结论＝至少有一条适用于这一路的说法，并且汇总后是强、弱或一般；说法不一＝不同UP主说法相反，不下结论。对抗路、中路、发育路的“对线强弱”在没有对线说法时用“前期强弱”的说法代替；发育路优先用双人对线的说法。
              </div>
              <ul className="list-disc pl-5">
                <li><b className="text-ink">怎么汇总：</b>按不同UP主计数（同一位UP主的多个视频只算一个来源）。只有一种说法就用它；强、弱两种说法都有时，多的一方至少多出两位UP主才下结论，否则显示“说法不一”。</li>
                <li><b className="text-ink">怎么比：</b>单人对线里，解说点名说过“甲对乙占优/吃亏”的，以它为准；否则比较双方各自的说法（强、一般、弱）。中辅抢线把中路和游走两个人的清线说法加在一起比，射辅对线把射手和辅助的说法加在一起比。只有一方有说法时写“可能占优/可能吃亏”，都没有就写“暂无结论”。</li>
                <li><b className="text-ink">怎么进入BP：</b>选人推荐里是单独的“对线强弱”分项（分值见上面的分项说明）；禁用推荐里，对方拿到后会在线上压制本方已选英雄的（点名的说法 {LANING_POINTS.direct} 分，强弱差每档 {LANING_POINTS.perStep} 分），以及解说点名说它对线压制“打算选的英雄”或英雄池里英雄的，会加分并写明理由，合计不超过 {DW.laningCap} 分。只是自己对线强、和本方没有可比对象的不加分。</li>
                <li><b className="text-ink">局限：</b>这是解说个人的看法，不是统计数据；讲某个英雄的视频容易偏向这个英雄；多数结论只有一位UP主的说法；对线强弱会随版本改动变化，每条说法都标了视频日期；覆盖面有限（见上表），没有说法的英雄不参与比较。</li>
              </ul>
            </>
          )}
        </Sec>

        <Sec id="about-backtest" title="回测">
          {!bt ? <Empty>尚未运行回测。</Empty> : (
            <>
              <p className="text-ink">{bt.note}</p>
              <p>生成于 {fmtDate(bt.generatedAt)}。训练期 {bt.train.from} 至 {bt.train.to}（{n(bt.train.picks)} 次选择）；测试期 {bt.test.from} 至 {bt.test.to}（{n(bt.test.picks)} 次选择，{n(bt.test.battles)} 局）。</p>
              <table className="w-full text-[13px]">
                <thead><tr><Th>方法</Th><Th>Top5命中率</Th><Th>Top10命中率</Th><Th>MRR</Th></tr></thead>
                <tbody><MethodRows ms={bt.methods} adopted={bt.adopted} /></tbody>
              </table>
              {bt.byPhase.map((p) => (
                <div key={p.phase}>
                  <div className="mb-1 text-[12.5px] text-ink">阶段：{p.phase}（样本 {n(p.n)}）</div>
                  <table className="w-full text-[13px]">
                    <thead><tr><Th>方法</Th><Th>Top5命中率</Th><Th>Top10命中率</Th><Th>MRR</Th></tr></thead>
                    <tbody><MethodRows ms={p.methods} adopted={bt.adopted} /></tbody>
                  </table>
                </div>
              ))}
              {bt.laneGiven && (
                <div>
                  <div className="mb-1 text-[12.5px] text-ink">指定位置后（只在能打“选手实际所打位置”的英雄里排，对应你设定“我打某路”的用法；样本 {n(bt.laneGiven.n)}）</div>
                  <table className="w-full text-[13px]">
                    <thead><tr><Th>方法</Th><Th>第1名命中率</Th><Th>前3命中率</Th><Th>前5命中率</Th><Th>MRR</Th></tr></thead>
                    <tbody><LaneRows ms={bt.laneGiven.methods} /></tbody>
                  </table>
                </div>
              )}
              {bt.recent && (
                <div className="rounded-md border border-line p-3">
                  <div className="mb-1 text-[13px] font-semibold text-ink">最近一届赛事留出：{bt.recent.league}</div>
                  <p className="mb-2">用它之前的全部对局训练（{bt.recent.train.from} 至 {bt.recent.train.to}，{n(bt.recent.train.picks)} 次选择），在这届赛事上测试（{bt.recent.test.from} 至 {bt.recent.test.to}，{n(bt.recent.test.picks)} 次选择，{n(bt.recent.test.battles)} 局）。</p>
                  <table className="w-full text-[13px]">
                    <thead><tr><Th>方法</Th><Th>Top5命中率</Th><Th>Top10命中率</Th><Th>MRR</Th></tr></thead>
                    <tbody><MethodRows ms={bt.recent.methods} adopted={bt.adopted} /></tbody>
                  </table>
                  <div className="mb-1 mt-3 text-[12.5px] text-ink">指定位置后（样本 {n(bt.recent.laneGiven.n)}）</div>
                  <table className="w-full text-[13px]">
                    <thead><tr><Th>方法</Th><Th>第1名命中率</Th><Th>前3命中率</Th><Th>前5命中率</Th><Th>MRR</Th></tr></thead>
                    <tbody><LaneRows ms={bt.recent.laneGiven.methods} /></tbody>
                  </table>
                </div>
              )}
              <div className="rounded-md bg-panel2 p-3 text-[12px] text-mute">
                <b className="text-sub">列说明：</b>Top5/Top10命中率＝职业队实际所选英雄出现在推荐前5/前10的比例；第1名/前3/前5命中率同理，但候选只有能打该位置的英雄；MRR＝实际所选英雄排名倒数的平均值，范围0–1，越大越好。命中率括号内为原始比例（三位小数）。没有计算置信区间。
              </div>
              <p>
                网站实际使用的方法：<span className="text-ink">{bt.methods.find((m) => m.id === bt.adopted)?.name ?? bt.adopted}</span>。{bt.adoptedReason}
              </p>
              <div className="rounded-md border border-line bg-panel2 p-3 text-[12.5px] leading-relaxed">
                <b className="text-ink">怎么读这张表：</b>
                “手工权重”是模型上线前使用的固定权重；“上一版模型”是加入“对线强弱”之前的模型（11个分项，其余设定相同）；“当前模型”多了“对线强弱”这一项。
                统计数据按周滚动重建，所以每一手用到的都是当时最新的数据，和你实际使用网站时的情形一致。
                各方法之间的差距只说明谁更接近职业队的选择，不能说明在路人局谁的建议更好。
              </div>
            </>
          )}
        </Sec>

        <Sec id="about-outcome" title="胜负检验">
          {!meta.outcomeTest ? <Empty>尚未运行胜负检验。</Empty> : (
            <>
              <p className="text-ink">回测看的是“像不像职业队的选择”，这一节看的是另一件事：网站对阵容的评估，和职业赛谁赢有没有关系。{meta.outcomeTest.note}</p>
              <p>共 {n(meta.outcomeTest.games)} 局；下表是“某一项占优的一方”的实际胜率（差值为0的对局不计）。</p>
              <table className="w-full max-w-3xl text-[13px]">
                <thead><tr><Th>哪一项占优</Th><Th>占优一方的胜率</Th><Th>样本数</Th><Th>95%区间</Th></tr></thead>
                <tbody>
                  {meta.outcomeTest.direct.map((d) => (
                    <tr key={d.key}><Td>{d.name}</Td><Td>{pct(d.winRate)}</Td><Td>{n(d.n)}</Td><Td>{pct(d.lo)}–{pct(d.hi)}</Td></tr>
                  ))}
                </tbody>
              </table>
              <p>用逻辑回归预测蓝方是否获胜（{meta.outcomeTest.train.from} 至 {meta.outcomeTest.train.to} 的 {n(meta.outcomeTest.train.n)} 局训练，{meta.outcomeTest.test.from} 至 {meta.outcomeTest.test.to} 的 {n(meta.outcomeTest.test.n)} 局测试）：</p>
              <table className="w-full max-w-3xl text-[13px]">
                <thead><tr><Th>使用的信息</Th><Th>准确率</Th><Th>AUC</Th><Th>对数损失</Th></tr></thead>
                <tbody>
                  {meta.outcomeTest.models.map((m) => (
                    <tr key={m.name}><Td>{m.name}</Td><Td>{pct(m.acc)}</Td><Td>{m.auc.toFixed(3)}</Td><Td>{m.logloss.toFixed(4)}</Td></tr>
                  ))}
                </tbody>
              </table>
              <div className="rounded-md border border-line bg-panel2 p-3 text-[12.5px] leading-relaxed">
                <b className="text-ink">怎么读：</b>
                职业赛的胜负主要由队伍强弱决定（Elo占优一方的胜率最高）；阵容层面的各项差值都只比50%高一两个百分点，多数区间跨过50%。
                也就是说，<b className="text-ink">在职业赛里，按本站的评估“阵容占优”并不能明显预测谁赢</b>。可能的原因：职业队双方的BP都很成熟，阵容差距本来就小；胜负更多取决于操作和配合；本站的克制关系有一部分是按职业和标签推出的泛化倾向。
                这个结论只针对职业赛。路人局里BP差距通常更大，克制的影响可能更明显，但没有数据可以验证。
                AUC＝随机取一局蓝方赢和一局蓝方输，模型给前者打分更高的概率，0.5等于瞎猜；对数损失越小越好。
              </div>
            </>
          )}
        </Sec>

        <Sec id="about-pending" title="待复核清单">
          {meta.pending.needsReview.length === 0 && meta.pending.missingProfile.length === 0 ? (
            <p>当前没有待复核的英雄。</p>
          ) : (
            <>
              <div><b className="text-ink">待复核（官方技能原文在档案撰写后有变）：</b>{meta.pending.needsReview.join('、') || '无'}</div>
              <div><b className="text-ink">缺少机制档案：</b>{meta.pending.missingProfile.join('、') || '无'}</div>
            </>
          )}
        </Sec>

        <Sec id="about-limits" title="已知限制">
          <ul className="list-disc pl-5">
            <li>路人局数据只有王者营地公开页面给出的部分：每个位置热度最高的10个英雄的档位、胜率、登场率、禁用率。完整榜单和英雄之间的对位胜率需要在营地App里登录才能看到，没有使用，所以路人局数据只用于“分路梯度”页和英雄页的展示，不参与推荐计分。</li>
            <li>“打法”（BP助手、阵容库、阵容对比里）的文字是通用战术说明：由打法表（{n(c.playbook)}条）和战术体系定义（{n(c.archetypes)}个）给出，按双方阵容的官方职业和已核实技能标签触发，每条都能展开看到触发它的英雄和技能原文。它们是人工撰写、经另一个模型复核的内容，没有用对局数据验证过，不代表胜率；其中的集火目标和分路对位来自关系库的证据计分。</li>
            <li>对线判断（三路对线、中辅抢线、射辅对线）只整理教学视频里解说的说法，覆盖面有限，详见上面的“对线强弱”一节；没有前几分钟经济这类对线数据可用。</li>
            <li>职业赛是系列赛全局BP，与单局排位不同，所以只使用了每个系列第一局的禁选次数、选手分路和同队共现，不计算胜率。</li>
            <li>官方关系每个英雄只有6条，且部分说明撰写时间较早。</li>
            <li>抖音等需要登录的平台未使用。</li>
            <li>排位选人顺序（蓝1→红2→蓝2→红2→蓝2→红1）没有找到官方文字说明，按通行顺序实现，禁用位数量可以自行调整。</li>
          </ul>
        </Sec>

        <Sec id="about-copyright" title="版权声明">
          <p>英雄资料、技能原文与图片著作权归腾讯所有，本站仅作学习与对局参考。</p>
        </Sec>
      </div>
    </div>
  );
}
