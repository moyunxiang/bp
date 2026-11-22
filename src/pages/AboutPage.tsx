import { useMemo, type ReactNode } from 'react';
import { useEngine, fmtDate, freshness } from '../lib/data.ts';
import { Empty } from '../components/ui.tsx';
import { W } from '../engine/relations.ts';
import { DEFAULT_WEIGHTS as DW, PART_NAME, type PartKey } from '../engine/recommend.ts';
import type { BacktestMethod } from '../types.ts';

const TOC = [
  ['update', '更新状态'], ['sources', '数据来源'], ['counts', '数量一览'], ['profile', '机制档案核实'], ['scoring', '证据等级与计分'],
  ['rules', '规则表'], ['backtest', '回测'], ['pending', '待复核清单'], ['limits', '已知限制'], ['copyright', '版权声明'],
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
  const { bundle, rel } = engine;
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

  const parts: { key: PartKey; desc: string }[] = [
    { key: 'counter', desc: `候选克制对方已选英雄时加分，被对方克制时扣分：每条关系按它的证据权重 × ${DW.counterPerUnit} 分，同路对线再 × ${DW.counterSameLane}；合计不超过 ±${DW.counterCap}` },
    { key: 'synergy', desc: `与己方已选英雄有配合关系时加分：每条关系按证据权重 × ${DW.synergyPerUnit} 分；合计不超过 ${DW.synergyCap}` },
    { key: 'needs', desc: `从第三手起，看候选能否补上阵容缺口（伤害类型、前排、硬控、开团、清线），越接近选完权重越大；合计不超过 ±${DW.needsCap}` },
    { key: 'lane', desc: `按候选在己方空缺分路上的适配度（0–1）计分，范围约 ±${DW.laneFit / 2}；己方剩下的分路都不是它的常规位置时为 ${DW.laneMiss}` },
    { key: 'meta', desc: `职业赛第一局的出场率（被选次数+被禁次数）÷ 局数 × ${DW.metaRange}，只加分不扣分；最近45天内官方公告标题写明“增强/削弱”的英雄另计 ±${DW.patch}` },
    { key: 'exposure', desc: `对方还有选人机会时，按“还没被禁、又克制它”的英雄的证据权重扣分，对方剩余手数越多扣得越多；最多扣 ${DW.exposureCap}` },
    { key: 'pool', desc: `只在“我的英雄池”模式下计算：熟练度每高一级 +${DW.poolPerLevel}` },
  ];


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
            <b className="text-gold">推荐分不是胜率。</b>它只是把已有证据按固定权重加总后的排序依据。<b className="text-gold">可信程度</b>表示该候选与多少个已选英雄之间存在已核实关系：关联越多，分数背后的依据越多；没有关联时分数主要来自位置、阵容需求等其他分项。
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
            <thead><tr><Th>名称</Th><Th>类型</Th><Th>依据的通用机制</Th><Th>成立条件</Th><Th>权重</Th><Th>触发关系数</Th></tr></thead>
            <tbody>
              {bundle.rules.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap text-ink">{r.name}</Td>
                  <Td><span className={r.type === 'counter' ? 'text-bad' : 'text-good'}>{r.type === 'counter' ? '克制' : '配合'}</span></Td>
                  <Td>{r.basis}</Td><Td>{r.condition}</Td><Td>{r.weight}</Td><Td>{n(ruleHits.get(r.id))}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          {bundle.rules.length === 0 && <Empty>没有规则。</Empty>}
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
              <div className="rounded-md bg-panel2 p-3 text-[12px] text-mute">
                <b className="text-sub">列说明：</b>Top5/Top10命中率＝职业队实际所选英雄出现在推荐前5/前10的比例；MRR＝实际所选英雄排名倒数的平均值，范围0–1，越大越好。命中率括号内为原始比例（三位小数）。
              </div>
              <p>
                网站实际使用的方法：<span className="text-ink">{bt.methods.find((m) => m.id === bt.adopted)?.name ?? bt.adopted}</span>。{bt.adoptedReason}
              </p>
              <div className="rounded-md border border-line bg-panel2 p-3 text-[12.5px] leading-relaxed">
                <b className="text-ink">怎么读这张表：</b>
                “只用热度+分路”一行不含任何克制、配合信息；它和“引擎：默认权重”一行的差距，就是克制、配合、阵容需求、先手暴露这些分项对“模仿职业选择”的净影响。
                回测的结论是：单英雄之间的克制关系对预测职业队的选择几乎没有帮助，职业队的选择主要由版本热度和分路决定。
                这不等于克制关系在路人局没有用，但现有数据无法验证路人局的效果。因此网站让“职业赛热度 + 分路”决定大致排序，克制与配合只在其上做小幅调整，并把每一条依据都展示出来，由你自己判断。
                另外，默认权重在调整时参考过同一年的回测结果，所以“引擎：默认权重”一行的成绩略偏乐观。
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
            <li>没有路人局胜率、登场率、禁用率（王者营地需要登录，未使用）。</li>
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
