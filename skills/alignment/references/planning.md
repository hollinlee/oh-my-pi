# Planning

## 目标

在用户和 agent 已经对齐后生成可执行计划。coding/repo 计划同时产出 GitHub issue drafts，但在用户确认前不创建 issue，也不开始实现。

## 规则

- 如果没有 Alignment Brief 或 Thought Brief，先回到 `/grill`。
- 如果 readiness 为 not ready，先继续提问。
- plan 不应默认写项目文件或改代码。
- coding/repo plan 应在同一轮按 `github-workflow/references/issues.md` 生成 vertical-slice issue drafts。
- plan 与 issue drafts 共用一次 human gate；用户确认后创建 issues 并输出 `/work-issue` 队列。
- 创建前必须能识别 target GitHub repo 且 `gh` 具备写权限；否则仍展示 plan 与 drafts，说明 blocker，并保留 `/to-issues` 恢复入口，不请求不可执行的创建确认。
- 用户拒绝创建时保留 plan 与 drafts 并停止；后续可用 `/to-issues` 恢复。
- issue 创建后仍停止，不自动执行 `/work-issue`。
- 非 coding/repo plan 不进入 GitHub workflow。
- plan 应该小步、可验证、可停止。

## Coding/repo plan

推荐结构：

```txt
Goal
Assumptions
Vertical slices
Likely files touched
Verification commands
Risks
Rollback
Stop points
```

## 非 coding/repo plan

推荐结构：

```txt
Goal
Decision
Next actions
Trade-offs
Risks
Review point
```

## Vertical slices

每个 slice 应满足：

- 能单独完成。
- 能单独验证。
- 不依赖大量未来假设。
- 尽量减少同时修改的文件范围。

## 停止点

- coding/repo：展示 plan 与 issue drafts 后停住，只等待一次 issue 创建确认；确认后创建 issues、输出 `/work-issue` 队列，再次停住。用户拒绝或 GitHub creation 不可用时保留 plan/drafts，不开始实现。
- 非 coding/repo：计划结尾停住，等待用户确认是否执行。
