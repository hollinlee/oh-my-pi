# Glass Treatment

## 适用条件

用于媒体上方控制层、少量悬浮导航或需要表达层叠空间的 premium consumer 界面。先有清楚的 primary direction，再决定是否需要 glass。

## 不适用条件

高密度 dashboard、公共服务、长表单、低性能设备优先场景或复杂背景不可控时避免使用。

## 兼容方向

通常适合 `cinematic-luxury`、克制的 `product-tech`，偶尔可服务 `organic` 的柔和层次。与 `neo-brutalist` 的主 surface 逻辑通常冲突。

## 表达原则

- 使用真实 backdrop separation，不只降低白色 opacity。
- 通过细内边缘、轻微高光和有限 blur 表达材质。
- 保持背景与文字的稳定对比。
- 只用于少量层级，不让每个 card 都变成玻璃。

## Fallback 与 accessibility

在 blur 不可用、背景过于复杂或用户偏好 reduced transparency 时，提供不透明 surface。Focus、border 和状态不能依赖透明度才能识别。

## Hard limits

- 不超过两个主要 glass surface 层级。
- 禁止 glass + 大面积 glow + 多重 gradient 同时成为焦点。
- 不使用 glass 包裹普通正文 section。
- Blur 不能掩盖布局和信息层级问题。
