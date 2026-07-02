---
description: 检查 GitHub PR 是否可合并；状态通过后执行 merge；默认 squash merge + delete branch
argument-hint: "<pr-number-or-url 可选>"
---

请使用 `github-workflow` skill 检查并合并 PR。

PR：

$ARGUMENTS

要求：

- 识别当前 PR。
- 按 `github-workflow` skill 的 merge reference 检查权威 blocking conditions。
- 用中文展示 merge summary 和风险。
- 默认使用 squash merge + delete branch。
- 如果没有 blocking condition，运行 `gh pr merge --squash --delete-branch`。
- 如果存在 blocking condition，说明原因并停住。
- 如果 repo 不允许 squash merge，先说明并询问使用哪种 merge strategy。
