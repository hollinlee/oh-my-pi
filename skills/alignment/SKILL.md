---
name: alignment
description: 对齐用户意图并在必要时进入计划。用于 /grill 和 /plan：先澄清目标、上下文、术语、约束、非目标和验收标准；coding/repo 任务可读取 repo 并维护私有 .pi/alignment context/ADR；未 ready 时不要直接计划或实现。
---

# Alignment

## 目标

帮助用户把模糊想法、coding 任务、repo 设计或个人决策想清楚。默认先对齐，不急着计划，更不急着实现。

核心原则：

```txt
/grill = 想清楚
/plan  = 想清楚以后怎么做
```

## 私有文档策略

本 skill 可以维护私有工作记忆，但只能写入：

```txt
.pi/alignment/
```

允许创建：

```txt
.pi/alignment/context.md
.pi/alignment/glossary.md
.pi/alignment/open-questions.md
.pi/alignment/latest-brief.md
.pi/alignment/sessions/<date>-<slug>.md
.pi/alignment/adr/<number>-<slug>.md
.pi/alignment/wayfinding/<slug>.md
```

硬规则：

- 不创建或更新 root `CONTEXT.md`。
- 不创建或更新 `docs/adr/`。
- 不为了 alignment artifacts 修改 `README.md`、`AGENTS.md` 或其他 tracked project files。
- 不从 tracked project files 引用 `.pi/alignment/`。
- 只有用户明确要求“提升到公开项目文档”时，才可以把私有内容改写进 tracked files。

`.pi/alignment` 是用户和 agent 的私有工作区，不是项目公开文档。

## 工作流

1. 判断任务类型。
   - 非 coding/repo：只做想法澄清，不读 repo，除非用户要求。
   - coding/repo：可以读取少量相关文件，并读取 `.pi/alignment` 中已有私有 context。
   - 如果不确定，询问用户是否需要结合当前 repo。
2. 选择 alignment mode。
   - simple grilling mode：用于当前 session 内能通过少量关键问题收敛的任务。
   - wayfinding mode：用于大而模糊、路线不清或继续已有 wayfinding map 的任务。
   - 详细判断和流程见 `references/wayfinding.md`。
   - 新 wayfinding map 必须先预览并等待用户确认。
3. 做 grilling。
   - 一次只问一个高价值问题。
   - 每个问题都给出推荐答案或默认取舍，降低用户负担。
   - 如果问题能通过读代码回答，优先读代码，不要让用户重复说明。
   - 在 wayfinding mode 中，每轮最多解决一个 investigation ticket；可以在回复末尾提出下一个 ticket 的问题。
   - 用户回答使当前 ticket resolved 后，如果仍未 ready 且存在未阻塞 ticket，立即在同一条回复中提出下一个关键问题。不要设置“确认后继续”或“回复继续”的人工门槛。
   - ticket 过渡默认只说明刚解决了什么，然后进入问题。详细状态写入私有 map；除非用户要求总结，不要逐轮复述完整结论、路径、规则、剩余 ticket 或 readiness 模板。
4. 对 coding/repo 任务做内部 domain modeling。
   - 澄清术语、实体、状态、边界、不变量。
   - 必要时更新 `.pi/alignment/glossary.md` 和 `.pi/alignment/context.md`。
   - 重大且难逆的决策可写私有 ADR。
5. 维护 brief。
   - 非 coding/repo 输出 Thought Brief。
   - coding/repo 输出 Alignment Brief。
   - brief 默认写入 `.pi/alignment/latest-brief.md`，同时在对话中总结。
6. 做 readiness check。
   - 未 ready：继续 grilling；有可推进问题时，当前回复必须以该问题结束，不能只给状态总结。
   - ready：可以响应 `/plan` 或用户明确要求生成计划。

## 输出格式

非 coding/repo 的 Thought Brief：

```txt
Goal
Why it matters
Current thinking
Constraints
Trade-offs
Open questions
Tentative direction
```

coding/repo 的 Alignment Brief：

```txt
Goal
Current state
Relevant context
Domain terms
Constraints
Non-goals
Acceptance criteria
Risks
Open questions
Readiness
```

Plan 输出：

```txt
Goal
Assumptions
Vertical slices
Likely files touched
Verification
Risks
Rollback
Stop points
```

## 按需参考

- 追问方式见 `references/questioning.md`。
- repo 上下文发现见 `references/context-discovery.md`。
- 私有 domain modeling 见 `references/domain-modeling.md`。
- ready 判断见 `references/readiness-checklist.md`。
- wayfinding mode 见 `references/wayfinding.md`。
- plan 生成见 `references/planning.md`。
