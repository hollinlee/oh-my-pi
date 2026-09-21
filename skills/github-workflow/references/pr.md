# Pull Request

## 目标

自动完成当前明确 issue/branch 的 commit、push 和 PR creation。既可作为 `/work-issue` 或 `/ship-changes` 的内部阶段，也可由 `/create-pr` 独立恢复执行。

## 规则

- 不在 commit 或 PR creation 前做低价值二次确认。
- PR body 可以引用 GitHub issue，例如 `Closes #123`。
- PR body 不得引用私有 alignment 文件或路径。
- 默认中文。
- `/create-pr` 创建 PR 后继续 checks/review/merge。
- `/work-issue` 和 `/ship-changes` 调用本阶段后同样继续 checks/review/merge。

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
- 当前 branch 从最新远端 base branch 建立，且记录了 verification 使用的 base/head SHA。
- PR 创建前已 fetch 远端；base drift、branch behind、mergeability 不明确或需要改写历史时停止。
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

1. 重新确认 base/head SHA 和 verification 仍然有效；base drift 时先暂停并按同步恢复规则处理。
2. 展示简短变更摘要、验证结果和 commit message。
3. 直接 commit。
4. push 当前 branch。
5. 生成并展示 PR title/body 摘要。
6. 直接运行 `gh pr create`。

7. 创建成功后按 `review.md` 继续 checks/review，再按 `merge.md` 检查并 merge。

如果 GitHub 写操作失败，说明已完成和未完成的 artifact，停止并提供可恢复状态。
