# 前端页面开发说明

本项目是《王者荣耀》英雄克制关系与BP辅助网站：纯静态站，Vite + React 19 + TypeScript + Tailwind v4，hash 路由，zustand。用户用手机打游戏，旁边电脑开着这个网站，所以**只针对桌面宽屏（1440px 及以上）设计**，不需要适配手机。

## 先读这些文件

| 文件 | 内容 |
|---|---|
| `src/types.ts` | 全部数据类型：`HeroData`、`HeroProfile`、`Bundle`、`Rule`、`Archetype`、`PatchNote`、`KplComps`、`BacktestReport` 等 |
| `src/styles.css` | 设计变量和组件类 |
| `src/components/ui.tsx` | `HeroAvatar`、`HeroLink`、`LaneBadge`、`TypeBadge`、`ConfidenceBadge`、`StatusBadge`、`Segmented`、`Empty`、`Section`、`Delta`、`Star` |
| `src/components/Evidence.tsx` | `KindBadge`、`KindBadges`、`EvidenceList`、`RelationCard`（展示一条关系的全部证据） |
| `src/lib/data.ts` | `useEngine()` 取得 `{ bundle, byId, rel, meta, metaScope }`（meta 是职业赛第一局禁选统计）；`useTagMap()`、`fmtDate`、`freshness`、`sortByName` |
| `src/lib/search.ts` | `searchHeroes(heroes, q)`：支持中文名、拼音、首字母、外号 |
| `src/lib/userStore.ts` | `useUser()`：英雄池、偏好、收藏、自定义阵容；`compKey`、`exportProfile` |
| `src/engine/relations.ts` | `RelationIndex`：`counters(id)`、`counteredBy(id)`、`synergies(id)`、`getCounter(a,b)`、`getSynergy(a,b)`、`net(a,b)`；`Relation`、`Evidence` 类型 |
| `src/engine/comp.ts` | `teamFeatures`、`matchArchetypes`、`heroesMatching`、`teamThreats`、`substitutes`、`damageType` |
| `src/engine/lanes.ts` | `assignLanes`、`primaryLane` |
| `src/engine/rules.ts` | `verifiedTags`、`profileUsable`、`evalCond` |
| `src/components/Layout.tsx`、`src/App.tsx` | 导航与路由（已配置好，不要改） |

数据在 `public/data/bundle.json`（约1MB），可以用 `node -e` 或 `python3` 读出来看实际内容和数量级。页面渲染时数据一定已就绪，直接 `useEngine()` 即可。

## 数据语义（必须理解）

- **关系 `Relation`**：`type: 'counter'` 表示 `a` 克制 `b`；`'synergy'` 无方向。`weight` 是计分权重，`weight === 0` 表示只有存疑证据。`evidence` 是已核实证据，`doubtful` 是存疑证据（不计分）。`scenes` 是适用场景。
- **证据类型**：`official` 官方页面的关系说明；`rule` 由双方技能原文按规则推导的“机制倾向”；`kpl` 职业赛同队共现；`commentary` 解说条目。官方 > 机制 > 职业赛 > 解说。
- **规则推导的关系很多**（上千条），权重低（0.3–0.6）；官方关系少（约830条），权重高（1.0–1.5）。列表默认按 `weight` 降序，并提供按证据类型筛选。
- **机制标签 `ProfileTag`**：`status: 'verified'` 才是已核实；`'disputed'` 是两位标注者不一致，要显示为“存疑”且注明不参与计分。`profile.status === 'needs_review'` 表示官方技能原文在档案撰写后变过，要给出提示。
- **`hero.lanes`**：5个数（0–1），下标0–4对应 对抗路/打野/中路/发育路/游走；`>= 0.5` 视为常规分路。`hero.laneSource` 是来源说明。
- **`hero.kpl`**：职业赛统计，可能为 `null`。`g1Recent`/`g1Year` 是“每个系列赛第一局被选/被禁次数”，窗口和总局数在 `bundle.kpl.heat`。
- **`hero.isLimited`**：限时英雄，排位/巅峰不可用，要有“限时”标记。
- **`hero.groupId`**：同组英雄是同一英雄的不同形态，BP中互斥。

## 内容诚信（硬性要求）

这个网站的核心承诺是不编造。写界面文字时：

- 不要出现任何胜率、强度排名、“T0/T1”、“版本强势”、“热门”之类的说法。职业赛数字只能写成“出现N次”“被选N次、被禁N次”，并注明是职业赛数据、不代表路人局。
- 凡是展示知识，都要能看到来源：官方说明要有官方页面链接和抓取日期；机制推导要能展开看到双方技能原文片段；职业赛数据要带样本量和时间范围。`EvidenceList` / `RelationCard` 已经做了这些，优先复用。
- 两个英雄之间没有任何关系时显示“暂无结论”，不要用空白或含糊的话带过。
- 推荐分、权重等数字不要写成百分比胜率，也不要用“%胜率”样式。
- 不要自己编写英雄玩法、连招、克制说明等文字；这些只能来自数据。界面上的说明性文字只解释“这个数字是什么、从哪来”。

## 视觉规范

- 深色界面。颜色只用 `styles.css` 里的变量对应的 Tailwind 类：`bg-bg / bg-panel / bg-panel2 / bg-panel3`，`border-line / border-line2`，`text-ink / text-sub / text-mute / text-dim`，`text-blue / text-red / text-gold / text-good / text-warn / text-bad`（以及 `bg-blue/15` 这类透明度写法）。蓝、红代表双方阵营；金色只用于推荐分；绿色表示配合/正向，红色（bad）表示克制/负向。
- 组件类：`panel`、`panel-title`、`btn`（`btn-primary`、`btn-ghost`、`btn-sm`）、`seg`（配合 `Segmented` 组件）、`chip`、`input`、`kbd`、`quote`、`prose-cn`。
- 字号：正文 13–14px，辅助信息 12px，标签 11–11.5px。信息密度偏高但要有清晰层次：标题、分组、留白要分明，不要把所有东西堆成一样的灰块。
- 所有可点击的东西要有 hover 状态；键盘可聚焦。列表较长时默认只显示一部分并提供“显示全部”。
- 中文与英文、数字相邻时不要加空格。界面文字全部用中文。
- 头像用 `HeroAvatar`（自带加载失败回退）。不要自己写 `<img>` 引头像。
- 不要用 emoji 当图标。

## 工程约束

- **不要安装新依赖**，不要改 `package.json`、`vite.config.ts`、`src/types.ts`、`src/styles.css`、`src/App.tsx`、`src/components/ui.tsx`、`src/components/Evidence.tsx`、`src/components/Layout.tsx`、`src/lib/*`、`src/engine/*`、`scripts/*`、`data/*`。如果确实需要共享代码里缺的东西，把辅助函数写在你自己的文件里，并在最后的报告里说明。
- 只创建和修改任务里指定给你的文件；需要拆分组件时放在任务指定的目录下。其他页面由别人同时在写，不要动。
- 图谱用自绘 SVG，不要引入图表库。
- 页面状态里“当前选中的英雄/阵容”等要能从 URL 参数恢复（用 `useSearchParams`），这样链接可以分享、其他页面可以带参数跳转过来。
- TypeScript 严格模式，`noUnusedLocals`、`noUnusedParameters` 都开着；不要用 `any`。
- 不要运行 `git` 命令，不要启动常驻的 dev server（会占端口）。

## 完成标准

1. `npx tsc --noEmit` 通过（如果报错只出现在不属于你的文件里，说明是别人正在写的文件，忽略并在报告里注明）。
2. `npx vite build` 通过。
3. 自己通读一遍渲染逻辑，确认边界情况：英雄没有档案（`profile` 为 `null` 或 `needs_review`）、没有职业赛数据（`kpl` 为 `null`）、关系列表为空、URL 参数里的英雄ID不存在。
4. 最后用一段话报告：做了哪些文件、有哪些功能、有什么没做或不确定的地方。
