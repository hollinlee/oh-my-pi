---
description: 为当前分支处理 commit、push 并创建 GitHub PR；先预览 commit message 和 PR title/body，确认后执行
argument-hint: "<issue-number-or-url 可选>"
---

请使用 `github-workflow` skill 为当前分支创建 PR。

关联 issue 或补充说明：

$ARGUMENTS

要求：

- 检查当前分支、工作树和 commit 状态。
- 识别关联 issue；如果无法识别，先问我。
- 如果有未提交变更，生成 conventional commit message，并用中文展示变更摘要、当前可依赖的验证结果和 commit message。
- 如果工作树干净且已有可用于 PR 的 commit，跳过 commit step，继续 push 和 PR 创建。
- 如果工作树干净且没有可用于 PR 的新 commit，停住并说明没有可创建 PR 的内容。
- 如果 `/work-issue` 本轮已经运行相关验证且之后没有新改动，可以复用并展示该验证结果。
- 如果验证缺失、过期，或 `/create-pr` 阶段发现额外改动，必须重新运行相关验证。
- 需要 commit 时，等我确认后才可以 commit。
- commit 后 push 当前分支。
- 生成中文 PR title/body。
- PR body 可以写 `Closes #123`，但不能引用 `.pi/alignment` 或任何私有对齐文件。
- PR body 包含 Summary、Verification、Risks。
- 先展示 PR title/body 预览。
- 等我确认后，才可以运行 `gh pr create`。
- 创建 PR 后停住，不要 merge。
