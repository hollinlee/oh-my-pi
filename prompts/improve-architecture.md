---
description: 在已有 codebase 中发现架构改善候选项，并在选择后进入 alignment grilling
argument-hint: "[范围或模块]"
---

请使用 `improve-architecture` skill，在已有 codebase 中寻找 architecture improvement candidates。

范围或模块：

${ARGUMENTS:-当前 repo}

要求：

- 只用于已有代码的架构改善发现，不用于代码前设计。
- 可以读取少量相关 repo 文件。
- 可以读取项目已有的长期上下文和相关架构决策资料，若存在且相关。
- 输出 markdown candidate report。
- report 后问我选择哪个 candidate 继续。
- 我选择 candidate 后，进入 alignment grilling，并停在 readiness check。
- 不要实现 refactor。
- 不要自动进入 `/plan`。
- 不要自动创建 GitHub issues。
- 不要添加 HTML report、extension、tool、TUI 或 package。
