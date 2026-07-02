# Issues

## 目标

把已确认计划拆成 GitHub issue drafts，并在用户确认后创建 issues。

## 规则

- 不直接创建 issue，必须先展示 drafts。
- 一个 issue 应该是一个 vertical slice。
- 不按技术层拆，例如 database-only、backend-only、frontend-only、tests-only。
- Issue 内容必须自洽，不能引用 `.pi/alignment`。
- 默认中文。
- 不要求 labels。

## Issue draft 格式

```md
# 标题

## 背景

## 范围

## 非目标

## 验收标准

- [ ] ...

## 验证方式

## 风险
```

## 创建前检查

- 是否独立可实现？
- 是否独立可验证？
- 是否适合作为一个 PR 候选？
- 是否包含验收标准？
- 是否没有 `.pi/alignment` 引用？

## gh CLI

用户确认后才运行：

```bash
gh issue create --title "..." --body "..."
```
