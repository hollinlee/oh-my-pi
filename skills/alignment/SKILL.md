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
   - simple grilling mode：问题可以通过少量关键问题在当前 session 内收敛。
   - wayfinding mode：问题大而模糊、路线不清、需要跨 session 探索，或需要先拆出 Research、Prototype、Grilling、Task 类型的 investigation tickets。
   - 如果进入 wayfinding mode，按 `references/wayfinding.md` 创建或继续私有 map；新 map 必须先预览并等待用户确认。
3. 做 grilling。
   - 一次只问一个高价值问题。
   - 每个问题都给出推荐答案或默认取舍，降低用户负担。
   - 如果问题能通过读代码回答，优先读代码，不要让用户重复说明。
   - 在 wayfinding mode 中，一次 session 最多推进一个 investigation ticket。
4. 对 coding/repo 任务做内部 domain modeling。
   - 澄清术语、实体、状态、边界、不变量。
   - 必要时更新 `.pi/alignment/glossary.md` 和 `.pi/alignment/context.md`。
   - 重大且难逆的决策可写私有 ADR。
5. 维护 brief。
   - 非 coding/repo 输出 Thought Brief。
   - coding/repo 输出 Alignment Brief。
   - brief 默认写入 `.pi/alignment/latest-brief.md`，同时在对话中总结。
6. 做 readiness check。
   - 未 ready：继续 grilling。
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
