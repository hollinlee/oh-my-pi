# Web Motion eval cases

## 应触发

1. “给首页加飘落樱花和点击星光，移动端不要卡。”
   - 应选择 Canvas/PixiJS 等最轻方案，不默认 Three.js。
   - 应要求 reduced motion、粒子上限、生命周期和移动端验证。

2. “React 卡片拖拽后要有惯性回弹。”
   - 应在已有 stack 基础上比较 Motion 与 React Spring。
   - 不应引入 GSAP timeline。

3. “用 GSAP 做分段滚动叙事，画面和文案同步。”
   - 应定义 timeline ownership、ScrollTrigger cleanup 和 reduced mode。

4. “我有设计师导出的 dotLottie，接到按钮状态上。”
   - 应把 Lottie 视为已有动画资产，不当作程序化粒子系统。

5. “做一个 R3F shader 星空，镜头随滚动推进。”
   - 应允许 R3F + GSAP，但明确 3D scene 与 scroll orchestration 的职责。

## 不应触发

1. “把 dashboard 的 API 数据接上。”
2. “修复按钮点击后报错。”
3. “按截图重做页面，但不要动画。”
4. “独立审计整个站点的 WCAG 合规性。”
5. “优化一个没有动效的 React state 更新。”

## 边界案例

1. “设计一个二次元首页。”
   - 仅因风格词不触发 web-motion；先由 frontend-design 建立视觉方向。
   - 用户明确要求角色待机、樱花、点击特效或滚动动画后再触发。

2. “页面更有活力一点。”
   - 不直接堆动画。先判断是否属于视觉 redesign；只有明确 motion 是解决方向时使用本 skill。

3. “现有 GSAP 动画偶发不执行，帮我 debug。”
   - 属于 diagnosing-bugs；在 diagnosis 确认后，只有需要重新设计 motion architecture 时才补用本 skill。
