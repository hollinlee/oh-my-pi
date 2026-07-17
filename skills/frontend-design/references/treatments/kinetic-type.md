# Kinetic Type Treatment

## 适用条件

当 typography 本身是主题、品牌或叙事核心时，用一个主要 motion 时刻强化标题、章节切换或交互反馈。

## 不适用条件

长读正文、高频操作、严肃表单、用户需要快速扫描数据，或 motion 只为制造“高级感”时不要使用。

## 兼容方向

适合 `editorial`、`neo-brutalist`、`cinematic-luxury`，也可为 `swiss-minimal` 提供精确的排版 transition。

## 表达原则

- Motion 应改变有意义的字重、字宽、位置、遮罩或内容状态。
- 只选择一个主要 kinetic sequence。
- 保持文字在动画前后都可读。
- 优先使用 transform、opacity 或 variable font axis，避免逐字符重排造成 layout churn。

## Fallback 与 accessibility

Reduced-motion 下直接显示最终状态或使用极短淡变。关键内容不能只在动画完成后出现；screen reader 文本保持稳定且不重复。

## Hard limits

- 正文段落不做逐字动画。
- 不同时使用 marquee、scramble、glitch 和字符飞入。
- 不因动画延迟导航或主要 CTA。
- 不让连续循环文字成为页面背景噪声。
