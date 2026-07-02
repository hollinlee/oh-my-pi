# Merge

## 目标

只在 PR 已经 ready 时合并。用户调用 `/merge-pr` 本身视为 merge 信号，不再要求二次确认。

## 规则

- `/handle-review` 不 merge。
- 只有 `/merge-pr` 可以 merge。
- 默认 squash merge + delete branch。
- merge 前必须展示中文 summary 和风险。
- 如果没有 blocking condition，直接执行 merge。

## Merge 前检查

`references/merge.md` 是 merge blocking conditions 的权威来源。其他 skill 或 prompt 只应引用这里，不要复制完整列表。

Blocking condition 指任何会阻止 `/merge-pr` 执行 merge 的状态。

必须检查：

- 当前 PR 已识别。
- PR 不是 draft。
- PR mergeability 为可合并。
- CI/status checks 通过。
- review 状态允许合并，没有 request changes。
- 没有未解决的 must-fix 或 blocking review comments。
- 本地工作树干净。
- base branch 和 PR branch 状态清楚。
- repo 支持 squash merge，或已明确选择其他 merge strategy。

任一条件不满足时，说明原因并停住。

## 默认命令

状态检查通过后运行：

```bash
gh pr merge --squash --delete-branch
```

如果 repo 不允许 squash merge，先说明原因并询问用户使用哪种 merge strategy。

## 禁止

- 在 `/handle-review` 中 merge。
- CI/review 状态不明时假装可 merge。
- 存在 blocking condition 时 merge。
