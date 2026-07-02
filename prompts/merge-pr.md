---
description: 检查 GitHub PR 是否可合并；状态通过后执行 merge；默认 squash merge + delete branch
argument-hint: "<pr-number-or-url 可选>"
---

请使用 `github-workflow` skill 检查并合并 PR。

PR：

$ARGUMENTS

要求：

- 识别当前 PR。
- 检查 CI/status checks。
- 检查 review 状态。
- 检查 unresolved comments。
- 检查本地工作树。
- 用中文展示 merge summary 和风险。
- 默认使用 squash merge + delete branch。
- 如果没有 blocking condition，运行 `gh pr merge --squash --delete-branch`。
- 如果 CI、review、comments、mergeability 或本地状态存在阻塞，说明原因并停住。
- 如果 repo 不允许 squash merge，先说明并询问使用哪种 merge strategy。
