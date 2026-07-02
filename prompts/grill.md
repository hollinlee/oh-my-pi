---
description: 拷问并澄清一个想法、问题、设计或 coding/repo 任务，直到足够清楚；coding/repo 任务可维护私有 .pi/alignment context/ADR
argument-hint: "<想法/问题/任务>"
---

请使用 `alignment` skill 对下面内容进行 grilling。

内容：

$ARGUMENTS

要求：

- 先判断这是否是 coding/repo 相关任务。
- 如果不是 coding/repo，专注帮我想清楚，不要默认读 repo。
- 如果是 coding/repo，可以读取少量相关 repo 文件，并读取 `.pi/alignment/` 中已有私有 context。
- 一次只问一个关键问题。
- 每个问题都给出你的推荐答案或默认取舍。
- 可以维护 `.pi/alignment/` 下的私有 brief、context、glossary 或 ADR。
- 不要创建或更新 `CONTEXT.md`、`docs/adr/`、`AGENTS.md`、`README.md` 等公开项目文档。
- 不要开始实现。

目标是让我想清楚，而不是马上计划或执行。
