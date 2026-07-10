---
description: 自动处理不改变 scope 的 GitHub PR review，验证、push 并触发复审；不 merge
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
- 处理后运行相关验证，自动 commit/push review fixes。
- 回复并 resolve 已处理 threads。
- 评论 `@sourcery-ai review` 触发复审，并读取新 review 后再次分类。
- review/fix/re-review 最多 2 轮；两轮后仍有 blocker 时停止。
- 不 merge；展示 review readiness 和剩余风险。
