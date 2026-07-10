# Review Handling

## 目标

自动读取和分类 review comments，处理不改变 scope 的反馈，重新验证、commit/push、resolve threads，并触发复审。既可作为 `/work-issue` 内部阶段，也可由 `/handle-review` 独立恢复执行。

## 分类

- `must-fix`：直接影响正确性、安全、验收或 merge readiness。
- `question`：需要回复或澄清。
- `suggestion`：可选改进。
- `nit`：低价值小问题。
- `out-of-scope`：超出当前 PR 范围。

## 自动处理策略

- 明确、in-scope、可验证的 must-fix：直接修复。
- 答案可从代码、issue 或验证确认的 question：直接回复。
- 不扩大 scope 且明显提升核心目标的 suggestion：可处理。
- 低价值、重复或规则膨胀的 suggestion/nit：回复简短理由后停止追逐。
- out-of-scope：拒绝或建议后续 issue。
- scope change、审美、API 语义取舍、风险变化或相互冲突的意见：触发 human decision gate。

不把 review comment 无条件当作编辑指令。

## 每轮流程

1. 读取 PR checks、reviews、comments 和 review threads。
2. 分类并展示简短处理结论。
3. 自动处理允许范围内的 comments。
4. 运行相关验证。
5. 有代码改动时生成 conventional review-fix commit 并 push。
6. 回复 comments，resolve 已处理 threads。
7. 评论 `@sourcery-ai review`。
8. 等待并读取新 review，再次分类。

自动 review/fix/re-review 最多 2 轮。两轮后仍有 must-fix 或 blocking thread 时停止。

## Merge continuation

- `/handle-review` 或 `/work-issue` 的 review 阶段完成后，继续调用 `merge.md` 的 authoritative merge gate。
- 只有低价值 suggestion/nit 时，不应为了追逐 reviewer 而无限阻塞 merge。
- 触发 human decision gate 或仍有 blocker 时停止，不得绕过 merge gate。

## Sourcery handling

Sourcery 是辅助 reviewer，不是 workflow owner。以下情况停止继续追逐：

- 新 review 只有低价值 suggestion 或 nit。
- 建议重复、已处理或不影响当前 PR 核心目标。
- 建议会造成规则膨胀或明显增加维护成本。
- 建议更适合后续 issue。

## gh CLI

可使用：

```bash
gh pr view --comments
gh pr checks
gh pr comment <pr> --body "@sourcery-ai review"
gh api ...
```

具体命令按需要选择，不编造无法确认的数据。
