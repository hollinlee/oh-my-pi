# Markdown Report

`improve-architecture` 的 report 用来帮助用户比较 architecture improvement candidates。它不是 implementation plan，也不是 refactor checklist。

## 格式

```md
# Architecture Improvements

## Top Recommendation

<推荐先 explore 哪个 candidate，以及为什么。保持简短。>

## Candidates

### 1. <candidate title>

Strength: Strong | Worth exploring | Speculative
Scope: <files / modules / area>
Problem: <当前 architecture friction>
Improvement: <建议改善方向，不写具体实现步骤>
Why now: <为什么这个问题值得现在看，而不是理论上可改>
Expected benefit: <locality / testability / simplicity / AI-navigability>
Risk: <主要风险、不确定性或可能冲突的既有决策>
Stop condition: <什么情况下不该继续 explore 这个 candidate>
```

## 字段说明

- `Strength` 表示推荐强度，不是优先级标签。
- `Scope` 帮用户判断影响面。
- `Problem` 必须来自真实 codebase friction。
- `Improvement` 描述方向，不要写逐步改代码方案。
- `Why now` 防止 report 变成理论重构清单。
- `Expected benefit` 应该说清改善如何提升 locality、testability、simplicity 或 AI-navigability。
- `Risk` 记录主要不确定性；如果可能冲突已有决策，也放这里。
- `Stop condition` 帮助 agent 和用户及时放弃不值得继续的方向。

## 候选项数量

默认 2-5 个 candidates。

少于 2 个时，说明为什么只有一个真实候选项。
多于 5 个时，先合并或过滤；用户需要的是可比较选择，不是完整清单。

## 推荐强度

使用这三个值：

- `Strong`：friction 明确，收益清楚，风险可控。
- `Worth exploring`：问题真实，但需要更多 grilling 才能判断是否值得做。
- `Speculative`：可能有改善空间，但证据弱或风险较高。

## 禁止

- 不写 implementation steps。
- 不生成 task list。
- 不承诺 refactor。
- 不把候选项写成 GitHub issues。
- 不引用私有 alignment 文件路径。
- 不列出每一个理论上能改的点。
