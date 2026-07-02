---
description: 读取一个 GitHub issue，创建常规分支，实现、验证，并在确认后 commit
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
- 等我确认后才 commit。
- commit 使用 conventional commits，type 英文，subject 可中文。
- commit 后停住，不要自动创建 PR。
