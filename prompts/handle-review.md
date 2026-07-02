---
description: 读取 GitHub PR review comments，分类、提出处理策略，确认后处理；不 merge
argument-hint: "<pr-number-or-url 可选>"
---

请使用 `github-workflow` skill 处理 PR review。

PR：

$ARGUMENTS

要求：

- 读取 PR review comments 和相关状态。
- 先分类 comments：must-fix、question、suggestion、nit、out-of-scope。
- 用中文展示分类结果和推荐处理策略。
- scope-changing comment 必须先问我。
- 等我确认处理策略后，才可以修改代码或回复 comment。
- 处理后运行相关验证，并用中文总结结果。
- 不要 merge。
