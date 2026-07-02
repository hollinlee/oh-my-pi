# Merge

## 目标

只在 PR 已经 ready 且用户明确确认后合并。

## 规则

- `/handle-review` 不 merge。
- 只有 `/merge-pr` 可以 merge。
- 默认 squash merge + delete branch。
- merge 前必须展示中文 summary 并等待确认。

## Merge 前检查

- 当前 PR 已识别。
- CI/status checks 通过，或用户明确接受风险。
- review 状态允许合并。
- 没有未解决的关键 comments。
- 本地工作树干净。
- base branch 和 PR branch 状态清楚。

## 默认命令

用户确认后运行：

```bash
gh pr merge --squash --delete-branch
```

如果 repo 不允许 squash merge，先说明原因并询问用户使用哪种 merge strategy。

## 禁止

- 未确认自动 merge。
- 在 `/handle-review` 中 merge。
- CI/review 状态不明时假装可 merge。
