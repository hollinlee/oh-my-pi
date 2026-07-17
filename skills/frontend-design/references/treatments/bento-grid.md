# Bento Grid Treatment

## 适用条件

用于多个真实独立对象具有不同优先级、媒体比例或交互深度时，通过不等尺寸 tile 建立概览。

## 不适用条件

线性叙事、长文章、简单 feature list 或所有对象同等重要时，不要为了趋势强行 bento 化。

## 兼容方向

适合 `product-tech`、部分 `swiss-minimal` 和克制的 `cinematic-luxury`。在 `editorial` 中应优先考虑真实跨栏结构，而非 tile dashboard。

## 表达原则

- Tile 尺寸必须对应信息优先级或内容形态。
- 每个 tile 是完整对象或任务入口，而不是装饰容器。
- 使用一致 grid 和少量 span 变化。
- 先设计阅读顺序，再设计拼图形状。

## Fallback 与 accessibility

DOM 顺序必须在无 grid 和 screen reader 中合理。小屏重排为清楚的优先级序列；不要用视觉位置改变语义顺序。

## Hard limits

- 不把普通 section 全部放进 tile。
- 不使用大量不同 radius、gradient 和 shadow 区分 tile。
- 不为了填空创建虚构 metrics 或装饰卡片。
- 小屏禁止保留不可读的桌面拼图比例。
