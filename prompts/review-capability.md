---
description: 审查一个已有 pi capability 的设计边界、资源分层和可维护性
argument-hint: "<路径>"
---

请使用 `design-pi-capability` skill 审查这个 pi capability：

$1

请重点检查：

- 是否选对了 pi 设计表面
- skill、prompt template、extension、tool、TUI、context file、package 的职责是否混淆
- 是否存在重复事实源
- 是否有不必要的 extension 或过重实现
- skill description 是否容易误触发
- prompt template 是否承担了过多方法论
- extension/tool 是否承担了本该由模型判断的内容
- 是否有更小的 MVP 设计

请按问题严重程度输出结论，并给出可操作的改进建议。
