# Review Handling

## 目标

读取 PR review comments，分类、提出处理策略，确认后处理，并重新验证。

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

## gh CLI

可使用：

```bash
gh pr view --comments
gh pr checks
gh api ...
```

具体命令按需要选择，不要编造无法确认的数据。
