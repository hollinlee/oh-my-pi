---
description: 读取一个 GitHub issue，创建常规分支，实现、验证、总结，然后停住；不 commit
argument-hint: "<issue-number-or-url>"
---

请使用 `github-workflow` skill 实现这个 GitHub issue。

Issue：

$ARGUMENTS

要求：

- 使用 `gh issue view` 读取 issue。
- 判断 issue 是否 ready；如果不 ready，先说明缺口，不要硬做。
- 检查工作树是否干净。
- 使用常规分支前缀创建或切换分支，例如 `feat/<issue-number>-<slug>`、`fix/<issue-number>-<slug>`。
- 实现 issue，并运行相关验证。
- 用中文展示变更摘要和验证结果。
- 不要 commit。
- 停住，并提示我之后可运行 `/create-pr` 处理 commit、push 和 PR 创建。
