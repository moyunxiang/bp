// 全站共享的数据类型。脚本与前端共用。

/** 分路：1对抗路 2打野 3中路 4发育路 5游走 */
export type Lane = 1 | 2 | 3 | 4 | 5;
export const LANES: Lane[] = [1, 2, 3, 4, 5];
export const LANE_NAME: Record<Lane, string> = { 1: '对抗路', 2: '打野', 3: '中路', 4: '发育路', 5: '游走' };
export const LANE_SHORT: Record<Lane, string> = { 1: '对抗', 2: '打野', 3: '中路', 4: '发育', 5: '游走' };

/** 官方职业：1战士 2法师 3坦克 4刺客 5射手 6辅助 */
export const HERO_TYPE_NAME: Record<number, string> = { 1: '战士', 2: '法师', 3: '坦克', 4: '刺客', 5: '射手', 6: '辅助' };

export interface OfficialSkill {
  idx: number;
  slot: string; // 被动 / 1技能 / 2技能 ...
  name: string;
  cooldown: string;
  cost: string;
  desc: string;
  icon: string;
}

export interface OfficialRelation {
  id: number;
  text: string;
}

export interface OfficialHero {
  id: number;
  name: string;
  idName: string;
  title: string;
  heroType: number;
  heroType2: number | null;
  releaseDate: string | null;
  isLimited: boolean;
  officialRoles: number[];
  groupId: string | null;
  avatar: string;
  ratings: { survive: number; attack: number; skill: number; difficulty: number };
  skills: OfficialSkill[];
  skillHash: string;
  rune: { ids: number[]; tips: string };
  builds: { items: number[]; tips: string }[];
  summoners: number[];
  relations: { partners: OfficialRelation[]; counters: OfficialRelation[]; counteredBy: OfficialRelation[] };
  sourceUrl: string;
  pinyin: string;
  initials: string;
}

// ---------- 机制档案 ----------

/** verified：撰写方与盲审方一致（或经裁定）；disputed：仅一方标注；unverified：尚未盲审 */
export type VerifyStatus = 'verified' | 'disputed' | 'unverified';

export interface ProfileTag {
  tag: string;
  slot: string;
  quote: string;
  status: VerifyStatus;
}

export interface ProseItem {
  text: string;
  refs: string[];
  quote?: string;
  status: VerifyStatus;
}

export interface ComboItem {
  order: string[];
  why: string;
  quote: string;
  status: VerifyStatus;
}

export interface HeroProfile {
  id: number;
  /** needs_review：官方技能原文在档案撰写后发生变化，整份档案不参与计分 */
  status: 'verified' | 'unverified' | 'needs_review';
  skillHash: string;
  tags: ProfileTag[];
  summary: string;
  strengths: ProseItem[];
  weaknesses: ProseItem[];
  combos: ComboItem[];
  interactions: ProseItem[];
}

// ---------- 版本公告 ----------

export interface PatchNote {
  id: number;
  title: string;
  date: string;
  url: string;
  /** direction 只在公告标题写明“增强/削弱”时为 buff/nerf，否则为 adjust */
  heroes: { id: number; name: string; direction: 'buff' | 'nerf' | 'adjust'; lines: string[] }[];
}

// ---------- KPL聚合 ----------

export interface KplHeroStat {
  /** 按分路的出场次数，下标0–4对应 对抗路/打野/中路/发育路/游走 */
  lanes: number[];
  lanesScope: 'recent' | 'all';
  /** 系列赛第一局（不受全局BP影响）被选/被禁的次数：近期窗口与一年窗口 */
  g1Recent: { pick: number; ban: number };
  g1Year: { pick: number; ban: number };
  /** 近期窗口内，系列赛第一局里按分路的出场次数 */
  g1LaneRecent?: number[];
  teamGames: number;
  /** 共现窗口（一年）内按分路的出场次数，分母是 pairs.teamGames */
  lanesYear?: number[];
  /** 近期窗口（60天）内按分路的出场次数，分母是 short.teamGames */
  lanesShort?: number[];
}

export interface KplStats {
  generatedAt: string;
  source: string;
  coverage: { battlesFetched: number; battlesUsable: number; from: string; to: string };
  heat: {
    recent: { windowDays: number; from: string; to: string; games: number };
    year: { windowDays: number; from: string; to: string; games: number };
  };
  lanes: { windowDays: number };
  short?: { windowDays: number; from: string; to: string; teamGames: number };
  pairs: {
    windowDays: number;
    from: string;
    to: string;
    teamGames: number;
    minN: number;
    list: { a: number; b: number; n: number; expected: number; lift: number }[];
  };
  /**
   * 选人响应统计（供选人模型使用）。vs：[c, e, 实际次数, 期望次数]，对面已亮出 e 之后 c 被选；
   * ally：[c, a, 实际次数, 期望次数]，队友已选 a 之后 c 被选。期望次数按 c 在同一赛事中的平均被选概率计算。
   */
  resp?: { windowDays: number; from: string; to: string; decisions: number; vs: [number, number, number, number][]; ally: [number, number, number, number][] };
  heroes: Record<string, KplHeroStat>;
}

export interface KplComps {
  generatedAt: string;
  windowDays: number;
  from: string;
  to: string;
  teamGames: number;
  trios: { heroes: number[]; n: number; first: string; last: string }[];
  lineups: { heroes: number[]; n: number; first: string; last: string }[];
}

/** 阵容底线的依据：近一年职业赛阵容里各条底线的满足比例，以及“各位置常用英雄随机拼”的对照比例 */
export interface CompFloorStats {
  generatedAt: string;
  from: string;
  to: string;
  teams: number;
  floors: Record<string, { must: { min: number; pro: number; shuffled: number } | null; should: { min: number; pro: number; shuffled: number } | null }>;
}

// ---------- 规则与关系 ----------

export type Scene = '对线' | '团战' | '前期' | '后期' | '全局';

/** 规则条件：tags=拥有其中任一标签的技能数≥min；heroType=官方主职业；none=档案中完全没有这些标签；all=全部满足 */
export interface Cond {
  tags?: string[];
  min?: number;
  heroType?: number[];
  none?: string[];
  all?: Cond[];
}

export interface Rule {
  /** 职业赛胜负检验：这条规则净次数占优一方的胜率、样本数、95%区间 */
  proCheck?: { n: number; winRate: number; lo: number; hi: number };
  /** 按胜负检验调整之前的权重 */
  weightBefore?: number;
  id: string;
  type: 'counter' | 'synergy';
  name: string;
  a: Cond;
  b: Cond;
  symmetric?: boolean;
  weight: number;
  scenes: Scene[];
  reason: string;
  condition: string;
  basis: string;
}

export interface TagDef {
  id: string;
  name: string;
  group: string;
  def: string;
}

/** 官方关系边。counter：a 压制 b；synergy：a 与 b 为搭档（无方向，a<b）。 */
export interface OfficialEdge {
  type: 'counter' | 'synergy';
  a: number;
  b: number;
  /** page：这段说明出自哪个英雄的官方页面 */
  texts: { page: number; text: string }[];
  /** 说明文字引用了当前技能原文中已不存在的技能名 */
  stale: boolean;
}

export interface CommentaryItem {
  id: string;
  type: 'counter' | 'synergy' | 'tip';
  a: number;
  b: number | null;
  claim: string;
  url: string;
  title: string;
  uploader: string;
  t: number | null;
  date: string;
  status: VerifyStatus;
}

// ---------- 英雄教学（连招、细节、克制关系；来自B站教学视频，逐条核对过字幕出处）----------

export interface GuideRef {
  bvid: string;
  /** 视频里讲到这一点的时间（秒） */
  t: number;
}

export interface HeroGuide {
  id: number;
  videos: { bvid: string; title: string; uploader: string; date: string; seconds: number }[];
  /** steps：数字按官方技能顺序（"1"=1技能…），"A"=普攻，"闪"=闪现，其余为文字 */
  combos: { steps: string[]; name: string; level: '基础' | '进阶'; note: string; refs: GuideRef[]; sources: number }[];
  tips: { title: string; text: string; refs: GuideRef[]; sources: number }[];
  /** type：counter=本英雄克制 hero；countered=被 hero 克制；synergy=配合 */
  matchups: { type: 'counter' | 'countered' | 'synergy'; hero: number; claim: string; refs: GuideRef[]; sources: number }[];
}

// ---------- 战术体系 ----------

export interface Archetype {
  id: string;
  name: string;
  /** 触发条件：满足 cond 的英雄数 ≥ count 的全部 need 都成立 */
  needs: { cond: Cond; count: number; label: string }[];
  description: string;
  winCondition: string;
  /** 这一体系通常怕什么：用标签描述，界面上据此列出具体英雄 */
  weakTo: { label: string; cond: Cond }[];
  /** 局内打法（通用战术说明）：前期、中期、团战、不要做什么 */
  play?: { early: string; mid: string; fight: string; avoid: string };
  /** 对面是这个体系时怎么打 */
  against?: string;
}

// ---------- 局内打法 ----------

/** 阵容特征（与阵容分析里的判定一致）；physical/magic/mixed 是主要伤害类型 */
export type PlayFeature = 'frontline' | 'hardCC' | 'aoeCC' | 'engage' | 'protect' | 'waveClear' | 'physical' | 'magic' | 'mixed';

/**
 * 触发条件的一句：某一方满足 cond（或 feature）的英雄数在 [min, max] 之间。
 * 只写 min（默认1）是“有”；写了 max 是“没有/不超过”，只在该方选满5人、且档案都可用时才判断。
 */
export interface PlayClause {
  side: 'ally' | 'enemy';
  /** 给命中的英雄起名，供 text 里用 {名字} 引用 */
  as?: string;
  cond?: Cond;
  feature?: PlayFeature;
  min?: number;
  max?: number;
}

export type PlaySection = 'plan' | 'opening' | 'danger' | 'build';

/** 打法条目：按双方阵容特征触发的通用战术说明，不是数据结论 */
export interface PlayEntry {
  id: string;
  /** plan=我方怎么打；opening=对面的突破口；danger=要防的点；build=出装与召唤师技能 */
  section: PlaySection;
  title: string;
  /** 可用 {名字} 引用 when 里命中的英雄，用 {items} 引用 items 关键词匹配到的装备 */
  text: string;
  when: PlayClause[];
  /** 这条说法依据的通用机制 */
  basis: string;
  /** 装备原文关键词：列出官方装备说明里含有该关键词的装备 */
  items?: string;
}

// ---------- 前端数据包 ----------

export interface HeroData extends OfficialHero {
  aliases: string[];
  /** 5条分路的适配权重（0–1），下标0–4对应 对抗路/打野/中路/发育路/游走 */
  lanes: number[];
  laneSource: string;
  profile: HeroProfile | null;
  /** 技能原文中“物理伤害/法术伤害/真实伤害”出现的次数 */
  dmg: { phys: number; magic: number; true: number };
  kpl: KplHeroStat | null;
}

export interface BundleMeta {
  generatedAt: string;
  officialFetchedAt: string;
  newsFetchedAt: string | null;
  season: string | null;
  latestPatchDate: string | null;
  counts: Record<string, number>;
  profileReport: { tagAgreement: number | null; tagsVerified: number; tagsDisputed: number; proseOk: number; proseDropped: number; reviewed: number; heroes: number; needsReview: number } | null;
  backtest: BacktestReport | null;
  /** 胜负检验：阵容差值与职业赛胜负的关系（内部检验，不含任何英雄胜率） */
  outcomeTest: OutcomeTest | null;
  pending: { needsReview: string[]; missingProfile: string[] };
}

export interface Bundle {
  meta: BundleMeta;
  heroes: HeroData[];
  officialEdges: OfficialEdge[];
  rules: Rule[];
  tags: TagDef[];
  patches: PatchNote[];
  kpl: Pick<KplStats, 'coverage' | 'heat' | 'pairs' | 'source' | 'resp' | 'short'> | null;
  /** 阵容底线在职业赛阵容里的满足比例（展示依据用，不参与计分） */
  floors: CompFloorStats | null;
  /** 由职业赛BP训练出的选人模型（各分项的系数）；没有时使用手工权重 */
  model: PickModel | null;
  comps: KplComps | null;
  archetypes: Archetype[];
  /** 局内打法条目 */
  playbook: PlayEntry[];
  equipment: {
    items: { id: number; name: string; desc: string }[];
    runes: { id: number; name: string; color: string; desc: string }[];
    summoners: { id: number; name: string; desc: string }[];
  };
  commentary: CommentaryItem[];
  /** 英雄教学内容，键为英雄ID */
  guides: Record<string, HeroGuide>;
  /** 王者营地英雄榜（路人局，各位置热度前10）；没有抓到时为 null */
  camp: CampData | null;
}

// ---------- 王者营地英雄榜 ----------
export interface CampEntry {
  id: number;
  /** 营地标注的热度档位，原样保留（T0、T1…） */
  tier: string;
  /** 胜率、登场率、禁用率，0–1，均为营地原始数字 */
  win: number;
  show: number;
  ban: number;
  /** 上一份数据里的档位；null=上次不在前10；undefined=没有可比较的上一份 */
  prev?: string | null;
}
export interface CampSegment {
  id: number;
  name: string;
  /** 不分位置的热度前10 */
  all: CampEntry[];
  lanes: Record<Lane, CampEntry[]>;
}
export interface CampData {
  source: string;
  url: string;
  fetchedAt: string;
  /** 营地标注的数据日期 YYYY-MM-DD */
  updateTime: string;
  prevUpdateTime: string | null;
  /** 公开接口每个榜单返回的英雄数上限 */
  limit: number;
  segments: CampSegment[];
}

// ---------- 选人模型 ----------

/**
 * 选人模型：条件 logit，P(选英雄 i) ∝ exp(Σ 系数 × 分项)。训练目标是职业队在每一手实际选了谁。
 * 系数按阶段分别拟合（第1–2手、第3–6手、第7–10手），并归一化到“分路匹配”的系数为1。
 */
export interface PickModel {
  trainedAt: string;
  /** 训练数据范围 */
  train: { from: string; to: string; picks: number };
  features: string[];
  /** 每个阶段的系数：phases[k].mult[分项] */
  phases: { name: string; fromOrder: number; toOrder: number; mult: Record<string, number> }[];
  /** 用户指定“我打某路”时使用的系数（候选只剩能打该位置的英雄）；没有则用 phases */
  lanePhases?: PickModel['phases'] | null;
  /** 为了保证“会看对方阵容”而设定的下限（见数据说明页） */
  floors: Record<string, number>;
  note: string;
}

// ---------- 胜负检验 ----------

export interface OutcomeTest {
  generatedAt: string;
  note: string;
  games: number;
  train: { n: number; from: string; to: string };
  test: { n: number; from: string; to: string; blueWinRate: number };
  models: { name: string; acc: number; logloss: number; auc: number }[];
  direct: { key: string; name: string; n: number; winRate: number; lo: number; hi: number }[];
}

// ---------- 回测 ----------

export interface BacktestMethod {
  id: string;
  name: string;
  top1?: number;
  top3?: number;
  top5: number;
  top10: number;
  mrr: number;
}

export interface BacktestReport {
  generatedAt: string;
  /** 回测衡量的是“职业队实际所选英雄在推荐列表中的位置”，目标是模仿职业选择，不代表选得最好 */
  note: string;
  train: { from: string; to: string; picks: number };
  test: { from: string; to: string; picks: number; battles: number };
  methods: BacktestMethod[];
  byPhase: { phase: string; n: number; methods: BacktestMethod[] }[];
  /** 指定位置后的评估：候选只留能打“职业选手实际所打位置”的英雄，对应用户设定“我打某路”的用法 */
  laneGiven?: { n: number; methods: BacktestMethod[] };
  /** 最近一届赛事留出测试：用它之前的全部对局训练 */
  recent?: { league: string; train: { from: string; to: string; picks: number }; test: { from: string; to: string; picks: number; battles: number }; methods: BacktestMethod[]; laneGiven: { n: number; methods: BacktestMethod[] } };
  /** 最终采用的方法 id 及原因 */
  adopted: string;
  adoptedReason: string;
}
