# Aurora Gradient Treatment

## 适用条件

用于建立一处环境光、品牌能量或空间深度，适合数字产品 hero、创意作品和需要柔和色场的场景。

## 不适用条件

内容本身已经色彩复杂、严肃公共信息、打印优先页面，或只因“现代”而添加时不要使用。

## 兼容方向

常与 `product-tech`、`cinematic-luxury` 配合；在 `organic` 中应从自然光和环境色推导。通常不适合主导 `swiss-minimal`。

## 表达原则

- 从 primary direction palette 选择少量相邻或有意义的颜色。
- 使用 layered radial gradient、SVG 或单个环境色场。
- Gradient 服务一个区域，不铺满所有按钮、文字和边框。
- 保持色场移动缓慢且不抢占内容。

## Fallback 与 accessibility

文字必须有稳定 surface 或足够对比。Reduced-motion 下停止 gradient animation；高对比模式下提供纯色背景。

## Hard limits

- 一次只保留一个主要 aurora 区域。
- 不与 gradient text、强 glow 和多层 glass 同时使用。
- 不用随机颜色弥补缺少品牌 palette。
- 不允许动画导致明显 repaint 压力或内容可读性波动。
