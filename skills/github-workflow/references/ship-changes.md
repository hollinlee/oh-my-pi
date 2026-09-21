# Ship Existing Changes

## 目标

`/ship-changes` 用于 implementation 已经发生、但尚未建立完整 GitHub artifact 链路的 recovery 场景：从当前 diff/commits 反向补建一个 issue，经一次确认后自动完成 branch、verification、commit、PR、review 和 merge。

它不是 `/work-issue` 的替代入口：

- 有明确 issue 且尚未实现时使用 `/work-issue`。
- 已有明确 issue、当前分支只差 PR 时使用 `/create-pr`。
- 没有 issue，但当前已有可归属实现时使用 `/ship-changes`。

## Readiness

先检查：

1. target repo、GitHub 写权限和 base branch 可可靠识别。
2. 当前 branch、工作树、staged/unstaged diff、未跟踪文件和相对 base 的 commits。
3. 当前改动是否为一个 independently reviewable、verifiable vertical slice。
4. 是否已有对应 issue、open PR 或已经合并的实现。
5. 是否存在敏感内容、生成物或无法归属的用户改动。

以下情况停止：

- 没有可 ship 的 diff 或 commits。
- 改动包含多个不相关 vertical slices；先展示建议拆分，等待用户决定。
- 改动归属不清或可能覆盖用户工作。
- 已有对应 issue/PR，但无法可靠判断应恢复哪个 artifact。
- commit 已直接落在 base branch，需要 reset、rebase、cherry-pick 或 force push 才能整理历史。
- target repo 或 GitHub 写权限不明确。

## Issue Draft Gate

根据实际实现反向生成一个自洽的中文 issue draft，格式遵循 `issues.md`。draft 必须描述目标和行为，不能把当前实现偶然采用的细节全部包装成预定需求。

展示：

- 改动归属结论。
- issue draft。
- 已有验证及需要补跑的验证。
- branch/commit 状态和主要风险。

创建 issue 前等待一次明确确认。用户确认后，该确认同时授权当前 recovery 链路中的 issue creation、branch、commit、push、PR creation、review reply、squash merge 和 branch deletion，不再重复请求常规确认。

## Recovery Flow

确认后：

1. 使用 `gh issue create` 创建 issue。
2. 如果当前在 base branch 且只有未提交改动，创建 conventional issue branch；切换必须保留当前工作树。
3. 如果当前已在明确 feature branch，继续使用该 branch；必要时确保 branch 与新 issue 的关联清楚，但不为了命名一致改写已发布历史。
4. 运行缺失、过期或受代码变化影响的验证。
5. 按 `pr.md` 自动 commit、push 和创建 PR，PR body 使用 `Closes #<issue>`。
6. 按 `review.md` 读取并分类 GitHub review comments，处理允许自动处理的反馈。
7. 按 `merge.md` 检查 authoritative blockers；无 blocker 时 squash merge + delete branch。
8. 切回 base branch并 fast-forward-only 同步，确认 issue closed、PR merged、工作树干净。

## History Boundary

以下操作不属于默认授权：

- reset base branch。
- rebase 或重写已有 commits。
- cherry-pick 以重组已提交历史。
- force push。
- revert 已推送或已发布的 base commit。

需要其中任一操作时触发 human decision gate，说明当前历史、建议方案和用户需要决定的唯一关键问题。

## Completion

只在以下条件全部满足时完成：

- issue 已创建并通过 closing linkage 关闭。
- PR 已 merge。
- required checks 和 authoritative merge gate 已通过。
- base branch 已同步。
- 工作树干净。
- feature branch 状态清楚。

最终输出 issue URL、PR URL、merge commit、验证结果和剩余风险。
