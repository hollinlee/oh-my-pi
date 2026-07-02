---
description: 基于已经对齐的内容生成计划；如果还没 ready，先回到 grilling 并补问关键问题
argument-hint: "<任务或已对齐内容>"
---

请使用 `alignment` skill 生成计划。

任务或上下文：

$ARGUMENTS

要求：

- 先读取当前对话中已有的 alignment/thought brief。
- 如果是 coding/repo 任务，也可以读取 `.pi/alignment/latest-brief.md`、`.pi/alignment/context.md`、`.pi/alignment/glossary.md` 和相关私有 ADR。
- 先做 readiness check。
- 如果还没 ready，不要硬写计划；请回到 grilling，并一次只问一个关键问题。
- 如果已经 ready，输出计划。
- 计划应包含目标、假设、步骤、验证方式、风险、回滚和停止点。
- 不要开始实现，除非我明确要求。
