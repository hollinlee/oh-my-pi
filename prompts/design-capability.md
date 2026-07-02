---
description: 设计一个新的 pi capability，并判断应该使用 skill、prompt template、extension、tool、TUI、context file、package 或 SDK/RPC
argument-hint: "<目标或场景>"
---

请使用 `design-pi-capability` skill 帮我设计一个 pi capability。

目标或场景：

$ARGUMENTS

请先不要直接写代码。先判断这个能力应该落在哪些 pi 设计表面：skill、prompt template、extension、tool、TUI、context file、package、SDK/RPC 或 theme。

输出请包含：

- capability 的真实用途
- 推荐的主要设计表面
- 如果需要组合多个表面，每一层的职责
- 不推荐的设计方式，以及原因
- 最小可用版本的文件结构
- 后续可以扩展的方向
