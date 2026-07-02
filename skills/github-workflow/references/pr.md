# Pull Request

## 目标

为当前分支创建 PR。先生成并展示 PR title/body，用户确认后才运行 `gh pr create`。

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
- 当前分支有 commit。
- 关联 issue 已识别。
- PR title/body 已预览。
- PR body 不包含 `.pi/alignment`。
- 用户已确认。

## gh CLI

用户确认后才运行：

```bash
gh pr create --title "..." --body "..."
```
