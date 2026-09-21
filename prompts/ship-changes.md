---
description: 为当前已完成改动补建 issue，并自动创建 PR、处理 review 和合并
argument-hint: "[改动说明]"
---

请使用 `github-workflow` skill 的 shipped-changes recovery workflow 处理当前已有改动：

补充说明：

$ARGUMENTS

要求：

- 先检查 target repo、base branch、当前 branch、工作树、staged/unstaged diff、未跟踪文件和相对 base 的 commits。
- 根据实际 diff 和 commits 判断改动是否构成单一、可验证的 vertical slice；不要把无关改动塞进同一个 issue/PR。
- 检查是否已有对应 issue 或 open PR，避免重复创建。
- 从已有实现反向生成一个中文 issue draft，包含背景、范围、非目标、验收标准、验证方式和风险。
- 创建 issue 前只保留一次 human gate：展示 issue draft、改动归属结论和计划验证，等我确认。
- 我确认后创建 issue，并把当前改动安全归入 conventional issue branch；不要丢失或覆盖已有改动。
- 如果 commit 已直接落在 base branch，或需要 reset、rebase、cherry-pick、force push 才能整理历史，停止并说明唯一关键决策，不要擅自改写历史。
- 验证缺失、过期或代码在验证后变化时，运行相关验证。
- 自动生成 conventional commit、commit 并 push；已有明确 feature-branch commit 时不要重复提交。
- 自动生成中文 PR title/body；body 包含 Summary、Verification、Risks 和 `Closes #<issue>`。
- 自动创建 PR，等待 required checks，并处理 GitHub review comments。
- 自动处理不改变 scope 的 review feedback，然后按 `references/merge.md` 检查 authoritative blockers。
- 无 blocker 时自动 squash merge + delete branch，切回并同步 base branch，确认 issue 关闭且工作树干净。
- issue 创建确认同时授权后续 branch、commit、push、PR、review reply 和 merge；不要重复请求低价值确认。
- 只有触发 human decision gate 或存在无法自动消除的 blocker 时停止。
- GitHub artifacts 不得引用 `.pi/alignment` 或其他私有对齐文件。
