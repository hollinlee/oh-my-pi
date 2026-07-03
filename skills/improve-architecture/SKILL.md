---
name: improve-architecture
description: 用于已有 codebase 的架构改善发现：扫描架构摩擦，输出 markdown improvement candidates，用户选择一个 candidate 后进入 alignment grilling；不实现 refactor。
disable-model-invocation: true
---

# Improve Architecture

## 目标

在已有 codebase 中发现值得进一步讨论的架构改善候选项。这个 skill 的产出是可判断的 markdown candidate report 和后续 alignment grilling，不是 refactor implementation。

适用场景：

- 用户明确要求改善、审视或寻找 architecture improvement。
- 代码已经存在，且需要找出 architecture friction、shallow modules、seam leakage 或 testability 问题。
- 用户想先比较多个重构方向，再决定是否进入 `/plan`。

不适用场景：

- 代码前设计或新功能方案探索。
- 普通 bug diagnosis。
- 用户已经给出明确 refactor 方案并要求直接实现。
- UI、TUI 或 visual prototype 探索。

## 核心原则

- 只发现和澄清 architecture improvements，不直接实现。
- 只提出基于真实 codebase friction 的 candidates，不列理论上可做的重构清单。
- report 必须让用户能比较候选项，而不是展示 agent 搜索过程。
- 用户选择一个 candidate 后，进入 alignment grilling；不要自动 `/plan`、创建 issue 或修改代码。
- 私有 alignment context/ADR 可作为上下文来源，但不要把私有路径写入公开 issue、PR 或项目文档。

## 默认流程

1. 确认任务是已有 codebase 的 architecture improvement discovery。
2. 如果用户给了范围或模块，优先聚焦该范围；否则先做少量 repo 探索。
3. 按 `alignment` skill 的私有文档策略读取项目长期上下文和相关架构决策资料，若存在且相关。
4. 阅读少量相关代码，寻找 architecture friction。
5. 形成 2-5 个 architecture improvement candidates。
6. 按 [markdown report 格式](references/markdown-report.md) 输出 report。
7. 明确推荐 top candidate，并说明为什么。
8. 问用户："你想继续 explore 哪个 candidate？"
9. 用户选择后，使用 `alignment` grilling 澄清该 candidate 的目标、约束、非目标、验收、风险和 readiness。
10. 必要时维护私有 brief、context 或 ADR。
11. readiness check 后停住。

## 上下文读取规则

可以读取：

- `alignment` skill 允许的私有 context，若存在且相关。
- `alignment` skill 允许的私有 glossary，若存在且相关。
- `alignment` skill 允许的相关私有 ADR。
- 用户指定范围内的源码、测试和配置。

不要为了显得全面而全仓库漫游。读到足够形成 report 时停止。

如果 candidate 可能违背已有架构决策，只在 risk 中说明冲突和继续探索的条件；不要直接推翻该决策。

## Architecture friction signals

优先寻找这些信号：

- 理解一个概念需要在许多小模块间跳转。
- module 很 shallow：interface 几乎和 implementation 一样复杂。
- seam leakage：实现细节或耦合责任跨 module 泄漏。
- locality 差：相关行为分散，真实 bug 藏在调用链里。
- testability 差：只能测试内部 helper，无法通过稳定 interface 验证行为。
- 删除某个抽象只会移动复杂度，而不是集中复杂度。

## Grilling handoff

用户选择 candidate 后，不要直接给 implementation plan。先进入 alignment grilling，澄清：

- 当前真实 friction 是什么。
- 改善目标是 deepen、simplify、collapse 还是 isolate。
- 哪些行为必须保持。
- 哪些 seam、adapter 或 module 边界需要保留。
- 哪些 tests 或验证方式能证明改善有效。
- 有没有已有决策或约束不应重开。

如果 grilling 后 ready，告诉用户可以下一步使用 `/plan`。不要自己启动 `/plan`。

## Stop Points

遇到这些情况先停住并说明缺口：

- codebase 不存在或目标范围无法定位。
- 用户实际需要的是代码前设计、bug diagnosis 或直接实现。
- 没有发现足够真实的 architecture friction。
- candidate 需要推翻已有重大决策，但缺少用户确认。
- report 之后用户还没有选择 candidate。
- 继续推进会进入 implementation、issue creation、PR 或公开文档修改。

## 禁止

- 不实现 refactor。
- 不自动修改代码。
- 不自动进入 `/plan`。
- 不自动创建 GitHub issues。
- 不添加 HTML report。
- 不添加 extension、tool、TUI 或 package。
- 不更新 README、AGENTS 或公开 docs，除非用户明确要求。
- 不把 prompt template 写成完整方法论；方法论保留在 skill 和 references 中。

## 输出原则

用户需要看到的是可判断产出：top recommendation、候选项对比、风险和停止条件。不要用读取文件数、搜索轮数或长篇过程记录包装价值。
