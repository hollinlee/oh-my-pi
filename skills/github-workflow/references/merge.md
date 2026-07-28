# Merge

## 目标

只在 PR ready 时合并。`/work-issue`、`/create-pr`、`/handle-review` 或 `/merge-pr` 的调用均视为各自 autopilot 链路中的 merge 授权，不再要求二次确认。

## 规则

- `/work-issue`、`/create-pr`、`/handle-review` 在到达 merge stage 后可以 merge；`/merge-pr` 直接从 merge stage 开始。
- 默认 squash merge + delete branch。
- merge 前必须展示中文 summary 和风险。
- 没有 blocking condition 时直接执行 merge。

## Merge 前检查

`references/merge.md` 是 merge blocking conditions 的唯一权威来源。其他 skill、reference 或 prompt 只引用这里，不复制完整列表。

Blocking condition 指任何会阻止 merge 的状态。

必须检查：

- 当前 PR 已识别。
- PR 不是 draft。
- PR mergeability 为可合并。
- required CI/status checks 通过；若已调用 Sourcery，初审必须完成且反馈已处理，但不等待 fix push 后的 optional 重审；未调用 Sourcery 的 PR 仍按 required checks、human review 和 unresolved blockers 判断。
- review 状态允许合并，没有 request changes。
- 没有未解决的 must-fix 或 blocking review comments。
- 本地工作树干净。
- base branch 和 PR branch 状态清楚。
- repo 支持 squash merge，或已明确选择其他 merge strategy。

任一条件不满足时，说明原因并停止。`/work-issue` 中还必须暂停后续 issue。

## 默认命令

```bash
gh pr merge --squash --delete-branch
```

如果 repo 不允许 squash merge，说明原因并触发 human decision gate，由用户选择其他 strategy。

## Merge 后

`/work-issue` 还必须：

1. 切回 base branch。
2. fast-forward-only 同步远端。
3. 确认 issue closing linkage 和 PR merge 状态。
4. 确认工作树干净。
5. 才能处理下一个 issue。

## 禁止

- 未完成 review 流程或未通过 authoritative blocking conditions 时 merge。
- CI/review 状态不明时假装可 merge。
- 存在 blocking condition 时 merge。
- merge 失败后继续队列后续 issue。
