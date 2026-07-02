# Pull Request

## 目标

为当前分支创建 PR，并接管 commit、push 和 PR 创建交付边界。先检查工作树；如有未提交变更，生成 commit message 并经用户确认后 commit；随后 push 分支，生成并展示 PR title/body，用户确认后运行 `gh pr create`。

## 规则

- PR body 可以引用 GitHub issue，例如 `Closes #123`。
- PR body 不得引用 `.pi/alignment`。
- 默认中文。
- 创建 PR 后停住，不 merge。

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
- 当前分支状态清楚。
- 如果有未提交变更，已生成 conventional commit message 并展示变更摘要、验证结果和 commit message。
- commit 前已获得用户确认。
- 当前分支已 push，或即将 push。
- 关联 issue 已识别。
- PR title/body 已预览。
- PR body 不包含 `.pi/alignment`。
- PR 创建前已获得用户确认。

## Commit

commit 使用 conventional commits：

```txt
feat: 添加 GitHub workflow skill
fix: 修复 prompt-intercept 加载路径
```

type 用英文，subject 默认可中文。

## gh CLI

必要时先 push 当前分支：

```bash
git push -u origin <branch>
```

用户确认 PR title/body 后才运行：

```bash
gh pr create --title "..." --body "..."
```
