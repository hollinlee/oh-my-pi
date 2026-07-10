---
description: 检查 GitHub PR authoritative blockers；状态通过后自动 squash merge + delete branch
argument-hint: "<pr-number-or-url 可选>"
---

请使用 `github-workflow` skill 检查并合并 PR。

PR：

$ARGUMENTS

要求：

- 识别当前 PR。
- 按 `github-workflow` 的 `references/merge.md` 检查 authoritative blocking conditions，不复制或弱化该列表。
- 用中文展示 merge summary 和风险。
- 默认使用 squash merge + delete branch。
- 如果没有 blocking condition，运行 `gh pr merge --squash --delete-branch`，不需要二次确认。
- 如果存在 blocking condition，说明原因并停止。
- 如果 repo 不允许 squash merge，说明原因并询问使用哪种 merge strategy。
