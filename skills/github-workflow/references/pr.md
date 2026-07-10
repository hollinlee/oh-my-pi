# Pull Request

## 目标

自动完成当前明确 issue/branch 的 commit、push 和 PR creation。既可作为 `/work-issue` 内部阶段，也可由 `/create-pr` 独立恢复执行。

## 规则

- 不在 commit 或 PR creation 前做低价值二次确认。
- PR body 可以引用 GitHub issue，例如 `Closes #123`。
- PR body 不得引用私有 alignment 文件或路径。
- 默认中文。
- 独立 `/create-pr` 创建 PR 后停住，不 merge。
- `/work-issue` 调用本阶段后继续 checks/review/merge。

## PR body 格式

```md
Closes #123

## Summary

- ...

## Verification

- ...

## Risks

- ...
```

## 创建前检查

- 当前分支不是 base branch。
- 当前分支、target repo 和关联 issue 已可靠识别。
- 工作树改动能明确归属当前 issue。
- verification 已运行且之后没有额外代码改动。
- verification 缺失、过期或代码变化时必须重跑。
- 工作树干净且没有新 commit 时，停止并说明没有可创建 PR 的内容。
- 工作树干净且已有用于 PR 的新 commit 时，跳过 commit step。
- PR body 不包含私有 alignment 引用或敏感信息。

任一归属或语义不明确时触发 human decision gate，不要猜测。

## Commit

自动生成 conventional commit：

```txt
feat: 添加 GitHub workflow autopilot
fix: 修复 prompt-intercept 加载路径
```

type 用英文，subject 默认中文。

## 执行

有未提交改动时：

1. 展示简短变更摘要、验证结果和 commit message。
2. 直接 commit。
3. push 当前 branch。
4. 生成并展示 PR title/body 摘要。
5. 直接运行 `gh pr create`。

如果 GitHub 写操作失败，说明已完成和未完成的 artifact，停止并提供可恢复状态。
