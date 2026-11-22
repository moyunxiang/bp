# 王者BP助手

《王者荣耀》英雄克制关系与BP辅助网站。手机打游戏，电脑开着网站：录入双方的禁用和选人，立刻得到带理由的Ban/Pick推荐；同时提供英雄机制百科、克制与配合图谱、战术阵容库。

在线地址：<https://moyunxiang.com/hok-bp/>（`https://moyunxiang.github.io/hok-bp/` 会跳转到这里）

网站是纯静态的，所有推荐都在浏览器里计算，不需要登录，也不依赖任何后台服务。

## 功能

| 页面 | 内容 |
|---|---|
| BP助手 | 排位赛、巅峰赛、自由模拟三种规则；全程可只用键盘录入；自动推测分路，可手动指定；Pick/Ban推荐带推荐分、可信程度和理由；候选对比；我的英雄池与理论最优切换；研究模式可展开每一项得分的原文依据和双方关系图 |
| 英雄百科 | 官方技能原文、四维、机制标签（带原文引用）、长处与短处、技能联动、克制/被克/配合关系及依据、官方推荐出装、近期版本改动 |
| 关系图谱 | 单英雄的克制/被克制/配合图，可点击继续探索；双方阵容对阵图，可按对线、团战、前期、后期筛选 |
| 阵容库 | 战术体系定义；职业赛中自动发现的阵容与三人组合（只有出现次数）；阵容分析（分路、构成、体系、协同、被克点、替代英雄）；自定义、收藏、对比 |
| 我的 | 英雄池与熟练度、默认偏好、收藏、导入导出 |
| 数据说明 | 数据来源、更新时间、各类证据的数量、核实情况、规则表、回测结果、已知限制 |

## 这个网站怎么保证不编造

- **关系只来自有据可查的证据**，分四级：官方页面的关系说明 > 由双方技能原文按规则推导的“机制倾向” > 职业赛同队共现 > 解说条目。每条关系都能在界面上展开看到来源。
- **机制标签必须带原文引用**。模型只负责从官方技能原文里提取“某技能有某机制”，并给出逐字的原文片段；脚本逐字校验；另一个模型独立再标一遍；两边一致才算已核实，不一致的由第三方按原文裁定。当前140个英雄的标签一致率为90.0%，已核实标签1429条。
- **克制和配合不由模型直接下结论**，而是由一张人工审定的规则表（`data/curated/rules.json`）根据标签计算。规则给出的是倾向，并写明成立条件。
- **没有依据就显示“暂无结论”**。约七成的英雄对之间没有任何结论，推荐时不会假设它们存在克制或配合。
- **没有路人局胜率、登场率、禁用率**（官方营地需要登录，没有使用），所以全站没有任何胜率或强度排名。职业赛数据只展示次数和样本量。
- **推荐分不是胜率**，是可解释的分项之和。
- 官方技能原文变化后，对应英雄的档案会自动标为“待复核”并停止参与计分。

## 本地运行

需要 Node.js 22 及以上。

```bash
npm install
npm run dev        # 开发模式
npm run build      # 类型检查 + 构建到 dist/
npm test           # 引擎单元测试
npm run e2e        # 构建后跑端到端冒烟测试（使用本机 Chrome）
```

## 更新数据

电脑开机时运行即可，网站本身不依赖它：

```bash
npm run update-data                 # 官方资料、公告、职业赛增量、重新校验、生成数据包
npm run update-data -- --backtest   # 另外重跑回测（约1–2分钟）
npm run update-data -- --commentary # 另外发现B站解说并读取字幕（需要 .env.local）
git add -A && git commit -m "Update data" && git push   # 推送后自动重新发布
```

网站右上角显示数据更新时间；超过14天会提示可能过期，超过30天会给出醒目提示。

各步骤也可以单独运行：

| 命令 | 作用 |
|---|---|
| `npm run fetch:official` 然后 `npx tsx scripts/parse-official.ts` | 抓取并解析官方英雄资料 |
| `npm run fetch:news` | 抓取正式服公告，提取英雄改动 |
| `npm run fetch:kpl -- --since=2025` 然后 `npx tsx scripts/build-kpl.ts` | 抓取职业赛逐局BP（可断点续跑）并聚合 |
| `npx tsx scripts/build-profiles.ts` | 校验机制档案的原文引用并合并 |
| `npm run build:data` | 生成 `public/data/bundle.json` |
| `npm run validate` | 校验数据包（引用完整性、原文引用、存疑内容不计分） |
| `npm run backtest` | 用职业赛历史对局回测推荐排序 |

### 更新机制档案（新英雄，或技能被调整后）

`update-data` 结束时会列出需要撰写或复核的英雄。这一步需要语言模型，在 Claude Code 里完成：

1. `npx tsx scripts/make-batches.ts --todo` 生成批次输入（`data/curated/_work/`）。
2. 让一个子任务按 `docs/curation/extract.md` 撰写档案，写到 `data/curated/heroes/`。
3. 让另一个子任务按 `docs/curation/review.md` 独立盲审，写到 `data/curated/review/`。
4. `npx tsx scripts/build-profiles.ts` 查看一致率；有分歧时按 `docs/curation/adjudicate.md` 裁定。
5. `npx tsx scripts/build-profiles.ts --stamp` 记录当前技能原文的版本，再 `npm run build:data && npm run validate`。

### 解说视频

1. 把 `.env.example` 复制为 `.env.local`，填入自己的B站 `SESSDATA`（只保存在本机，不进仓库）。
2. `npx tsx scripts/commentary/discover.ts` 发现候选视频；`npx tsx scripts/commentary/fetch-subtitles.ts` 读取AI字幕到 `data/raw/commentary/`（不进仓库）。脚本低频访问，遇到风控会立即停止。
3. 在 Claude Code 里按 `docs/curation/commentary.md` 把字幕提炼成条目，写到 `data/curated/commentary/`。
4. `npx tsx scripts/commentary/build.ts` 汇总并自动核实，然后 `npm run build:data`。

抖音需要登录才能访问内容，没有使用。

## 我的英雄池与偏好

在“我的”页面编辑后保存在浏览器里。想长期保留或换电脑使用：在该页面导出 `profile.json`，覆盖仓库里的 `user/profile.json` 并提交，网站重新发布后以它为默认值。

## 目录

```
scripts/        抓取、整理、校验、回测
data/raw/       第三方原始数据（职业赛逐局、公告正文、字幕），不进仓库
data/curated/   机制档案、盲审与裁定记录、规则表、战术体系定义、外号
data/derived/   脚本产出的整理结果（官方资料、聚合统计、档案合并结果、回测报告）
public/data/    前端加载的数据包
user/           个人数据的公开默认值
src/engine/     推荐引擎（纯函数）：分路推断、BP规则、关系索引、评分、阵容分析
src/pages/      各页面
tests/          单元测试与端到端测试
docs/curation/  机制档案和解说条目的撰写、盲审、裁定规范
```

## 数据来源与限制

- 英雄资料、技能原文、官方关系：王者荣耀官网英雄详情页。
- 版本公告：官网公告接口，只保留标题、日期、链接和逐条改动。
- 职业赛BP：腾讯官方赛事数据中心。职业赛是系列赛内全局BP，与单局排位不同，所以只使用每个系列第一局的禁选次数、选手分路和同队共现，不计算胜率。原始逐局数据不进仓库。
- 排位选人顺序（蓝1 → 红2 → 蓝2 → 红2 → 蓝2 → 红1）没有找到官方文字说明，按通行顺序实现；禁用位数量可在界面上调整。
- 回测衡量的是“职业队实际选的英雄排在推荐列表的第几位”，目标是模仿职业选择，不代表选得最好，也不能说明路人局的效果。结果见数据说明页。

## 声明

英雄资料、技能原文与图片著作权归腾讯所有，图片直接引用官方地址。本项目仅作学习与对局参考，与腾讯无关联。
