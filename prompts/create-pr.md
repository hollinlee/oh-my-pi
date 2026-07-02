---
description: 为当前分支创建 GitHub PR；先预览中文 PR title/body，确认后执行 gh pr create
argument-hint: "<issue-number-or-url 可选>"
---

请使用 `github-workflow` skill 为当前分支创建 PR。

关联 issue 或补充说明：

$ARGUMENTS

要求：

- 检查当前分支和 commit 状态。
- 识别关联 issue；如果无法识别，先问我。
- 生成中文 PR title/body。
- PR body 可以写 `Closes #123`，但不能引用 `.pi/alignment` 或任何私有对齐文件。
- PR body 包含 Summary、Verification、Risks。
- 先展示 PR title/body 预览。
- 等我确认后，才可以运行 `gh pr create`。
- 创建 PR 后停住，不要 merge。
