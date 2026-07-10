---
description: 从当前明确分支自动 commit、创建 PR、处理 review 并合并
argument-hint: "<issue-number-or-url 可选>"
---

请使用 `github-workflow` skill 为当前分支创建 PR。

关联 issue 或补充说明：

$ARGUMENTS

要求：

- 检查当前分支、工作树和 commit 状态。
- 识别关联 issue；无法可靠识别时只问一个关键问题。
- 如果有未提交变更，确认它们可归属当前 issue，并检查验证是否有效。
- 验证缺失、过期或代码在验证后发生变化时，重新运行相关验证。
- 自动生成 conventional commit message，展示简短摘要后直接 commit。
- 工作树干净且已有用于 PR 的新 commit 时跳过 commit step。
- 工作树干净且没有可用于 PR 的新 commit 时停止，说明没有可创建 PR 的内容。
- 自动 push 当前 branch。
- 自动生成中文 PR title/body；body 包含 Summary、Verification、Risks 和关联 issue。
- PR body 可以写 `Closes #123`，但不得引用 `.pi/alignment` 或私有对齐文件。
- 展示 PR 摘要后直接运行 `gh pr create`，不要做低价值二次确认。
- 创建 PR 后继续等待 checks、处理 review，并按 `references/merge.md` 检查 authoritative blockers；无 blocker 时自动 squash merge + delete branch。
- 只有触发 human decision gate、review 轮次耗尽或存在无法自动消除的 merge blocker 时停止。
