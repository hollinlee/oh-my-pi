---
description: 自动处理 GitHub PR 初审，验证并在 ready 后合并
argument-hint: "<pr-number-or-url 可选>"
---

请使用 `github-workflow` skill 处理 PR review。

PR：

$ARGUMENTS

要求：

- 读取 PR checks、reviews、comments 和 review threads。
- 分类 comments：must-fix、question、suggestion、nit、out-of-scope。
- 用中文展示简短分类和处理结论。
- 自动处理明确、in-scope、可验证的 must-fix。
- 自动回复答案可从代码、issue 或验证确认的 question。
- scope-changing、审美、API 语义取舍、风险变化或冲突意见必须停止，只问一个关键问题。
- 低价值、重复、规则膨胀、nit 或 out-of-scope 建议应说明理由并停止追逐。
- PR 尚未经过 Sourcery 初审时，只评论一次 `@sourcery-ai review` 并等待初审。
- 处理后运行相关验证，自动 commit/push review fixes。
- 回复并 resolve 已处理 threads。
- 不主动触发或等待 Sourcery 重审；required checks 通过后直接进入 merge gate。
- review ready 后按 `references/merge.md` 检查 authoritative blockers；无 blocker 时自动 squash merge + delete branch。
- 只有触发 human decision gate、初审仍有 blocker 或 merge gate 未通过时停止，并展示剩余风险。
