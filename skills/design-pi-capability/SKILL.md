---
name: design-pi-capability
description: 设计、审查或重构 pi capability。用于判断一个工作流应该落在 skill、prompt template、extension、tool、TUI、context file、package、SDK/RPC 或 theme 的哪一层，并设计它们之间的组合方式。
---

# Design Pi Capability

## 目标

当用户想为 pi 增加一种能力时，先使用本 skill 判断它应该落在哪个设计表面，再决定具体文件结构和实现方式。

这里的 capability 指 pi 中可被用户、模型或 harness 使用的一类能力，包括但不限于：

- skills
- prompt templates
- extensions
- extension tools
- TUI components
- AGENTS.md / context files
- settings
- pi packages
- SDK / RPC integrations
- themes

## 核心原则

先问“这是什么类型的能力”，再问“怎么实现”。

不要因为用户说了“skill”就直接写 `SKILL.md`；也不要因为可以写 extension 就把所有东西做成 TypeScript。pi 的设计表面各自有边界：判断和流程放 skill，快捷入口放 prompt template，确定性机制放 extension/tool，项目长期事实放 context file，跨项目分发放 package。

## 工作流程

1. 复述用户想要的 capability，以及它要服务的真实工作场景。
2. 判断它的性质：判断型还是确定性，长期还是一次性，用户触发还是模型自动触发，是否需要 UI、状态、外部系统或分发。
3. 使用 [能力表面决策矩阵](references/decision-matrix.md) 选择主要设计表面。
4. 如果需要组合多个表面，明确每一层的职责，避免重复表达同一规则。
5. 对需要人机协作的 workflow，使用 [workflow design principles](references/workflow-design-principles.md) 检查可感知产出、递减主动性和显式人类判断。
6. 设计最小可用版本，优先让方法论先跑通，再增加 extension、tool 或 TUI。
7. 使用 [审查清单](references/review-checklist.md) 检查 cognitive load、context load、可维护性和误触发风险。

## 默认取舍

- 能用 prompt template 解决的，不急着做 skill。
- 能用 skill 表达的判断，不写进 extension。
- 能用 extension/tool 保证的机制，不交给模型自由发挥。
- 能放进项目 context 的长期事实，不复制到每个 skill。
- 能用 package 组合分发的，不要求用户手工复制多个目录。
- 第一版先做窄，跑通后再扩。

## 参考文档

- [pi capability 表面](references/capability-surfaces.md)
- [能力表面决策矩阵](references/decision-matrix.md)
- [组合模式](references/composition-patterns.md)
- [workflow design principles](references/workflow-design-principles.md)
- [审查清单](references/review-checklist.md)
