---
description: 读取 GitHub PR review comments，分类、提出处理策略，确认后处理并触发 Sourcery 复审；不 merge
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
- 处理后运行相关验证，commit/push review fixes，并用中文总结结果。
- 触发 Sourcery 复审：在 PR 下评论 `@sourcery-ai review`。
- 读取新 review 后再次分类，判断建议是否符合当前 PR 核心目标。
- 对低价值、重复、超出当前目标或会造成规则膨胀的建议，建议停止处理或转为后续 issue。
- 不要 merge。
