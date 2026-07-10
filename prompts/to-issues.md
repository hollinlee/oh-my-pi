---
description: 将已确认计划拆成 GitHub issue drafts，经确认后创建并输出有序 work-issue 队列
argument-hint: "<计划或范围>"
---

请使用 `github-workflow` skill，把下面的计划或范围拆成 GitHub issues。

计划或范围：

$ARGUMENTS

要求：

- 先读取当前对话中已确认的 plan；必要时可读取 `.pi/alignment/latest-brief.md`，但不能在 issue 中引用该路径。
- 每个 issue 必须是一个 vertical slice。
- 默认用中文生成 issue drafts。
- issue draft 不得引用 `.pi/alignment` 或任何私有对齐文件。
- 先展示 drafts 和拆分理由。
- 等我确认后，才可以使用 `gh issue create` 创建 GitHub issues。
- 创建后按计划顺序输出可直接运行的显式队列，例如 `/work-issue 51 52 53`。
- 不要开始实现。
