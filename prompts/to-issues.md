---
description: 独立将当前计划或范围拆成 issue drafts，经一次确认后创建并输出 work-issue 队列
argument-hint: "<计划或范围>"
---

请使用 `github-workflow` skill，把下面的计划或范围拆成 GitHub issues。

计划或范围：

$ARGUMENTS

要求：

- 先读取当前对话中的 plan；必要时可读取 `.pi/alignment/latest-brief.md`，但不能在 issue 中引用该路径。
- 这是 `/plan` 联动流程的 standalone/recovery entry；不要要求用户先单独确认 plan。
- 每个 issue 必须是一个 vertical slice。
- 默认用中文生成 issue drafts。
- issue draft 不得引用 `.pi/alignment` 或任何私有对齐文件。
- 先展示 drafts 和拆分理由。
- 创建前确认 target GitHub repo 可识别且 `gh` 具备写权限；不可用时保留 drafts、说明 blocker，不请求不可执行的创建确认。
- 只保留一次 human gate：等我确认后使用 `gh issue create` 创建 GitHub issues。
- 如果我拒绝创建，保留 plan/drafts 并停止，后续仍可通过 `/to-issues` 恢复。
- 创建后按计划顺序输出可直接运行的显式队列，例如 `/work-issue 51 52 53`。
- 不要自动执行该队列或开始实现。
