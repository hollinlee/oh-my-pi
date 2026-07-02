# Review Handling

## 目标

读取 PR review comments，分类、提出处理策略，确认后处理、重新验证、commit/push，并触发 Sourcery 复审。复审结果必须再次分类和判断，不要无休止追逐低价值建议。

## 分类

- `must-fix`：必须修复。
- `question`：需要回复或澄清。
- `suggestion`：可选建议。
- `nit`：小问题。
- `out-of-scope`：超出当前 PR 范围。

## 规则

- 不把 review comment 当成自动编辑指令。
- 先分类，再提出中文处理策略。
- scope-changing comment 必须用户确认。
- 修改代码或回复 comment 前需要确认处理策略。
- 处理后运行相关验证。
- review fixes 完成后 commit/push 到 PR 分支。
- 触发 Sourcery 复审：在 PR 下评论 `@sourcery-ai review`。
- 新 review 出现后再次分类，判断建议是否符合当前 PR 核心目标。
- 不 merge。

## 输出

```txt
Review summary

must-fix
- ...

question
- ...

suggestion
- ...

nit
- ...

out-of-scope
- ...

Recommended handling
- ...
```

## Sourcery handling

Sourcery 是辅助 reviewer，不是 workflow owner。

建议停止继续处理 Sourcery 的情况：

- 新 review 只有低价值 suggestion 或 nit。
- 建议重复、已处理或不影响当前 PR 核心目标。
- 建议会造成规则膨胀、重复表达或明显增加维护成本。
- 建议属于后续改进，更适合新 issue。
- 用户选择进入 `/merge-pr`。

## gh CLI

可使用：

```bash
gh pr view --comments
gh pr checks
gh pr comment <pr> --body "@sourcery-ai review"
gh api ...
```

具体命令按需要选择，不要编造无法确认的数据。
