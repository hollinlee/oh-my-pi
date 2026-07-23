---
name: web-motion
description: 为网页中的关键动效、滚动叙事、手势反馈、2D/3D 粒子和设计师动画选择实现技术并约束性能与可访问性。用于用户明确要求动画、motion、悬浮/点击特效、视差、樱花/粒子、Lottie、GSAP、Motion、React Spring、Canvas、PixiJS、Three.js 或 R3F 时；普通 UI 实现、纯视觉定稿、无动效变化的 frontend 工作或独立性能/a11y audit 不使用。
---

# Web Motion

## 目标

让动效承担明确的交互、叙事或品牌职责，并使用满足效果的最轻技术实现。不要用动画数量代替视觉方向，不要为了展示技术引入 3D、粒子或多个 motion runtime。

## 与其他能力的边界

- `frontend-design` 负责整体视觉语言、层级、构图和 signature；本 skill 只负责 motion 的角色、技术和实现约束。
- 视觉方向尚未确定且任务包含页面设计时，先使用 `frontend-design`，再根据其 design contract 设计 motion。
- 普通 frontend bug、已有动画的明确代码错误和测试失败属于 debugging，不借本 skill 扩大 redesign scope。
- 独立 accessibility 或 performance audit 不触发本 skill；但实现动效时必须完成本 skill 的相关检查。

## 工作流

1. **读取约束**：检查技术栈、已有 animation library、design system、目标设备、浏览器支持、素材格式和页面核心任务。已有 runtime 默认优先，除非它明显无法满足需求。
2. **定义职责**：给每个候选动效标记为 `feedback`、`transition`、`orientation`、`narrative` 或 `decorative`。无法归类或不改善体验的动效删除。
3. **选择最轻实现**：完整读取 [技术选择](references/technology-selection.md)，按效果而不是流行度选择 CSS、Motion、GSAP、React Spring、Lottie/Rive、Canvas/PixiJS 或 Three.js/R3F。默认只新增一个主要 motion runtime。
4. **建立 motion contract**：编码前给出下面五项。上下文充分时直接继续，不把它变成确认门。
5. **渐进实现**：先完成静态和 reduced-motion 版本，再增加增强动效。保持内容、导航和关键操作不依赖动画完成。
6. **管理生命周期**：清理 timeline、listener、observer、RAF、WebGL/Canvas 资源；页面隐藏、元素离屏或组件卸载时暂停或释放持续工作。
7. **验证**：完整读取 [交付检查](references/quality-check.md)，按实际能力报告 `motion-render-verified` 或 `motion-code-checked`。

## Motion contract

```md
Motion role: <主要职责；可列一个主职责和一个次职责>
Engine: <已有或新增技术，以及不用更重方案的原因>
Behavior: <触发、持续时间/物理特性、退出和中断方式>
Budget: <移动端降级、粒子/DPR/持续循环和 bundle 约束>
Reduced mode: <关闭、替换或弱化哪些效果>
```

要求：

- 一个页面只保留一个主要 motion signature；其他动效作为反馈或过渡。
- `decorative` 不能阻塞内容、捕获 pointer、改变布局或成为理解页面的前提。
- hover 效果必须有 touch/keyboard 对应行为，不能持续抖动文本或关键控件。
- 点击粒子只能增强已经完成的操作反馈，不能延迟操作或遮挡目标。
- 大面积移动、缩放、视差和持续粒子必须提供 reduced mode；优先在 `prefers-reduced-motion: no-preference` 下启用增强效果。
- 不同时引入 GSAP、React Spring、Motion 和 Anime.js 处理同一类 DOM 动画。
- Lottie/Rive 用于已有设计师动画资产；没有对应资产时不要把它当程序化粒子引擎。
- Three.js/R3F 只用于真实 3D、shader、相机、深度或 GPU 场景；普通 2D 花瓣不因此升级到 WebGL。

## 停止条件

遇到以下情况先询问用户：

- 动效会改变现有品牌气质、信息层级或核心交互，但用户未授权 redesign。
- 关键效果依赖缺失的 Lottie、Rive、sprite、模型或贴图素材，替代方案会显著改变结果。
- 必须新增第二个大型 motion runtime，且无法通过现有技术或轻量实现满足需求。
- 目标设备、浏览器或性能下限会实质改变技术方案，但上下文无法确定。

## 验证状态

- `motion-render-verified`：实际在浏览器中检查过关键 viewport、交互触发、reduced motion 和持续动画生命周期；涉及粒子或 WebGL 时还检查过至少一个移动端 viewport。
- `motion-code-checked`：只完成代码、类型、测试和静态规则检查，尚未观察真实渲染与帧表现。

没有 browser 或等效渲染能力时，不得声称动效流畅、视觉已验收或性能达标。
