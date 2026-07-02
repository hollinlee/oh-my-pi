# Private Domain Modeling

## 目标

在 coding/repo 任务中维护项目私有语言，帮助用户和 agent 长期对齐术语、边界和决策。

所有产物只能写入：

```txt
.pi/alignment/
```

## Glossary

当术语被澄清时，更新：

```txt
.pi/alignment/glossary.md
```

推荐格式：

```md
## Term

Definition: ...
Not: ...
Examples: ...
Related code: ...
Last updated: YYYY-MM-DD
```

## Context

当出现长期项目事实时，更新：

```txt
.pi/alignment/context.md
```

只记录对 agent 有帮助的事实：目录边界、能力边界、长期约定、命名规则、常见风险。

## Private ADR

只在同时满足以下条件时创建 `.pi/alignment/adr/<number>-<slug>.md`：

1. 决策难以轻易反转。
2. 未来的自己或 agent 看到结果会疑惑。
3. 真的存在取舍，不是显而易见的实现细节。

ADR 格式：

```md
# 0001 Title

## Context

## Decision

## Alternatives

## Consequences

## Visibility

Private agent note under .pi/alignment. Do not reference from tracked project files.
```

## 禁止

- 不写 root `CONTEXT.md`。
- 不写 `docs/adr/`。
- 不从 tracked files 引用 `.pi/alignment`。
- 不把私有 notes 当成公开项目文档。
