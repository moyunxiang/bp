# 英雄机制档案盲审规范（核实方）

你是独立核实方。目的是检验另一位撰写者的工作，方法是**你先完全独立地做一遍标签**，再审对方写的说明文字。**唯一的依据是输入文件里的官方技能原文**，不要使用记忆中的游戏知识。

严格按下面两步的顺序做。

## 第一步：独立打标签（此时不要打开 `data/curated/heroes/` 下的任何文件）

输入批次文件（JSON）：`heroes[]`，每个英雄有 `id`、`name`、`heroType`、`skills[]`（`slot`、`name`、`cooldown`、`cost`、`desc`）。标签词表：`data/curated/tags.json`，每个标签的 `def` 是判定标准。

对每个英雄逐个技能对照词表，原文明确写出某效果才标注：

- 同一标签在不同技能上出现要分别记录；同一技能同一标签只记一条。
- `quote` 必须是该技能 `desc` 里逐字连续的一段原文，6–40 个字，不改字、不拼接、不含换行。
- 拿不准就不标。`cc_hard_aoe`、`suppress` 必须与 `cc_hard` 同时出现在同一技能上。

把结果先写入 `data/curated/review/{id}.json`（只含 `id`、`name`、`tags`），写完这一批全部英雄的标签后再进入第二步。

## 第二步：审对方的说明文字

现在读取 `data/curated/heroes/{id}.json`，**只看** `summary`、`strengths`、`weaknesses`、`combos`、`interactions` 这几项（不要因为看到对方的 `tags` 而回头修改你第一步的标签）。逐条对照原文判断：

- `ok`：原文能直接支持这句话。
- `unsupported`：原文不支持、与原文矛盾、含有无法从原文验证的内容（强度评价、无数字支撑的比较、隐藏机制、其他英雄名、对线胜负等），或“没有某机制”的说法与原文不符。

然后把审查结果补进你的文件，最终 `data/curated/review/{id}.json` 结构为：

```json
{
  "id": 105,
  "name": "廉颇",
  "tags": [ { "tag": "dash", "slot": "1技能", "quote": "廉颇向前冲锋" } ],
  "prose": [
    { "field": "strengths", "index": 0, "verdict": "ok" },
    { "field": "combos", "index": 1, "verdict": "unsupported", "reason": "原文没有写2技能会强化1技能" }
  ]
}
```

`prose` 要覆盖对方文件里的每一条（`summary` 用 `"field": "summary", "index": 0`）。`unsupported` 必须写 `reason`。

## 完成后

用一段话报告：处理了哪些英雄ID、判了多少条 `unsupported`、有没有原文难以判断的地方。不要在报告里重复档案内容。
