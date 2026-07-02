---
description: 将 Claude/Codex/其他 agent 的 workflow 或 skill 迁移为 pi capability
argument-hint: "<来源路径或说明>"
---

请使用 `design-pi-capability` skill，把下面的 agent workflow 迁移为 pi capability：

$ARGUMENTS

不要机械复制原结构。请重新判断：

- 哪些内容应该成为 pi skill
- 哪些内容应该成为 prompt template
- 哪些确定性能力应该成为 extension tool
- 是否需要 extension command 或 TUI
- 哪些项目事实应该留在 context file
- 是否应该打包成 pi package

请先输出迁移设计，再决定是否创建文件。
