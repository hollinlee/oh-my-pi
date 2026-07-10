# Issues

## 目标

把已确认计划拆成 GitHub issue drafts，并在用户确认后创建 issues。创建后输出按计划顺序排列的显式 `/work-issue` 队列。

## 规则

- 不直接创建 issue，必须先展示 drafts。
- 一个 issue 应是 independently implementable、verifiable 的 vertical slice。
- 不按 database/backend/frontend/tests 等技术层拆分。
- Issue 内容必须自洽，不能引用私有 alignment 文件或路径。
- 默认中文。
- 不要求 labels。
- 创建顺序应与建议执行顺序一致。

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
- 是否适合作为一个 PR？
- 是否包含验收标准？
- 是否没有私有 alignment 引用？
- 执行顺序和依赖是否清楚？

## 创建后输出

issues 创建后输出可复制的显式队列：

```txt
/work-issue 51 52 53
```

只包含本次确认创建的 issues，不扫描其他 backlog。
