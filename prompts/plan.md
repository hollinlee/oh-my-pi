---
description: 基于已对齐内容生成计划；coding/repo 任务同时生成 issue drafts，共用一次创建确认
argument-hint: "<任务或已对齐内容>"
---

请使用 `alignment` skill 生成计划。

任务或上下文：

$ARGUMENTS

要求：

- 先读取当前对话中已有的 alignment/thought brief。
- 如果是 coding/repo 任务，也可以读取 `.pi/alignment/latest-brief.md`、`.pi/alignment/context.md`、`.pi/alignment/glossary.md` 和相关私有 ADR。
- 先做 readiness check。
- 如果还没 ready，不要硬写计划；请回到 grilling，并一次只问一个关键问题。
- 如果已经 ready，输出计划。
- 计划应包含目标、假设、步骤、验证方式、风险、回滚和停止点。
- coding/repo 任务在同一轮使用 `github-workflow` 的 issue draft 规则，把计划拆成 vertical slices；plan 与 drafts 一起展示。`coding/repo` 的定义以 `alignment` skill 为准。
- 创建前确认 target GitHub repo 可识别且 `gh` 具备写权限；不可用时仍输出 plan 与 drafts，说明 blocker，并保留 `/to-issues` 恢复入口，不请求不可执行的创建确认。
- plan 与 issue drafts 只使用一次 human gate；等我确认后创建 GitHub issues，并输出显式 `/work-issue` 队列。
- 如果我拒绝创建，保留 plan 与 drafts 并停止；后续可通过 `/to-issues` 恢复。
- 创建 issues 后停止，不要自动执行 `/work-issue`。
- 非 coding/repo 任务只输出计划，不进入 GitHub workflow。
- 在确认前不要创建 issue、修改项目文件或开始实现。
