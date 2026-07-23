# 交付检查

## 用途

- 每个动效是否属于 `feedback`、`transition`、`orientation`、`narrative` 或 `decorative`？
- 是否只有一个主要 motion signature？
- 删除动画后，内容、导航和关键操作是否仍完整可用？
- 是否避免持续抖动、无意义 parallax 和重复 reveal？

## 可访问性

- 是否响应 `prefers-reduced-motion`，并对大面积移动、缩放、视差和持续粒子提供关闭或替代版本？
- 是否避免每秒三次以上的闪烁？
- hover 是否有 keyboard 和 touch 对应反馈？
- 装饰 Canvas/WebGL/Lottie 是否不进入 accessibility tree、不捕获 pointer？
- 自动持续运动是否可暂停，或在 reduced mode 中停止？
- 动画是否不会改变 focus 顺序、延迟 focus 或隐藏当前操作结果？

## 性能

- DOM 动画是否优先使用 `transform` 和 `opacity`，避免逐帧 layout/paint？
- 是否避免每帧创建对象、节点、纹理或闭包？
- 粒子是否限制并发和总量，并针对窄 viewport、低性能设备或 coarse pointer 降级？
- Canvas/WebGL 是否限制 device pixel ratio，而不是无条件使用设备最高 DPR？
- 持续 RAF、ticker、timeline 是否在 hidden/offscreen/unmount 时暂停或销毁？
- Three.js geometry、material、texture、render target 和 renderer 是否按 ownership 正确 dispose？
- 是否避免为单一小效果引入大型重复 runtime？

## 交互与布局

- 快速重复点击、反向滚动和中途打断时，状态是否可预测？
- 动画是否不改变文档布局，或已明确处理 layout shift？
- overlay 是否使用正确 stacking context，且不遮挡 dialog、menu、tooltip 和 focus ring？
- resize、orientation change、route transition 和 bfcache 恢复后是否正常？
- 动画结束状态是否稳定，不依赖 `animationend` 才执行关键业务逻辑？

## 验证矩阵

至少检查：

1. 默认桌面 viewport。
2. 一个移动端 viewport。
3. `prefers-reduced-motion: reduce`。
4. keyboard 导航和 touch/coarse-pointer 替代行为。
5. 快速重复触发和组件卸载。
6. 涉及持续粒子、Canvas 或 WebGL 时，检查页面隐藏、离屏和 resize 生命周期。

只有实际观察上述关键路径，才能报告 `motion-render-verified`；否则报告 `motion-code-checked`，并列出未验证项。
