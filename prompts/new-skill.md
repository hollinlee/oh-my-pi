---
description: 在确认适合使用 skill 后，设计并创建一个新的 pi skill
argument-hint: "<skill-name> <目标>"
---

请使用 `design-pi-capability` skill，先确认这个目标是否真的适合做成 pi skill。

Skill 名称：$1

目标：

${@:2}

如果不适合做成 skill，请说明更适合的 pi 设计表面。

如果适合，请设计一个最小可用 skill：

- `SKILL.md` 只放触发条件、核心原则和执行主线
- 大块参考内容放进 `references/`
- description 要具体说明何时使用
- 避免复制项目长期事实
- 避免把确定性检查写成自然语言要求

在动手创建文件前，先给出文件结构和设计理由。
