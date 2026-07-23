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
- 选择 alignment mode：当前 session 可用少量问题收敛时使用 simple grilling；问题大而模糊、路线不清或需要继续已有 map 时使用 wayfinding mode。
- 新 wayfinding map 必须先展示 draft，经我确认后才写入 `.pi/alignment/wayfinding/`。
- 如果我说“继续 wayfinding”但没有给 map path，先列出 `.pi/alignment/wayfinding/` 下可用 maps，让我选择。
- 如果我给了 wayfinding map path，读取指定 map，并且一次只推进一个未阻塞 ticket。
- 一个 ticket resolved 后，如果仍为 not-ready 且存在未阻塞 ticket，在同一条回复末尾直接提出下一个关键问题；不要要求我先确认、回复“继续”或重新调用 `/grill`。
- ticket 之间只做一句短过渡。详细结论写入 wayfinding map；除非我要求总结，不要重复输出已解决事项的完整路径、规则清单、剩余问题清单或 readiness 模板。
- 可以维护 `.pi/alignment/` 下的私有 brief、context、glossary、ADR 或 wayfinding map。
- 不要创建或更新 `CONTEXT.md`、`docs/adr/`、`AGENTS.md`、`README.md` 等公开项目文档。
- 不要开始实现。

目标是让我想清楚，而不是马上计划或执行。
