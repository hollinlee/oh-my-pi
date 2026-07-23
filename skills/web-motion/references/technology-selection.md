# 技术选择

先选效果模型，再选库。已有项目 runtime 能满足需求时，复用优先。

## 快速决策

| 需求 | 默认选择 | 升级条件 |
| --- | --- | --- |
| hover、focus、pressed、淡入、位移、颜色变化 | CSS transition / animation | 需要可中断状态编排或复杂 orchestration |
| React 状态、presence、layout transition、手势 UI | Motion | 已有 React Spring，或需要明确物理连续性 |
| 弹簧、惯性、拖拽、速度连续且可中断 | React Spring | 需要精确 timeline、scroll choreography |
| 多步骤时间线、SVG/DOM/Canvas 编排、ScrollTrigger | GSAP | 只是简单 reveal 时退回 CSS/IntersectionObserver |
| AE 导出的图标、loading、角色片段 | Lottie | 需要状态机和丰富交互时考虑 Rive |
| 设计师制作的交互式 vector animation | Rive | 只是播放固定片段时 Lottie 更简单 |
| 少量随机装饰粒子 | CSS 或 Canvas 2D | sprite 数量、混合和批量绘制增加时用 PixiJS |
| 大量 2D sprite、花瓣、光点、点击爆发 | PixiJS / Canvas | 需要真实深度、相机、shader 或 3D 模型时用 Three.js |
| 3D 场景、GPU 粒子、shader、后处理、模型 | Three.js；React 项目可用 R3F | 没有真实 3D 需求时降级 |

## 常见效果

### 悬浮反馈

优先 CSS `transform`、`opacity`、颜色和阴影过渡。避免持续 shake；短促位移或 scale 只表达可交互性。键盘 `:focus-visible` 和 touch pressed state 必须有等价反馈。

### 飘落樱花或雪花

- 少量、低频、纯背景：CSS。
- 需要随机轨迹、风场和复用对象：Canvas 2D。
- 大量 sprite、纹理 atlas、混合模式：PixiJS。
- 只有需要 3D 深度、景深、相机穿越或 shader 风场时用 Three.js。

粒子层设置 `pointer-events: none`，不进入 accessibility tree。使用对象池或复用实例，避免每帧创建 DOM 节点和对象。

### 点击特效

优先 Canvas overlay 或已有 motion runtime。以 pointer 坐标生成短生命周期效果；限制并发数量，失焦、路由切换和卸载时清理。不能拦截点击，也不能延迟业务事件。

### 滚动叙事

简单 reveal 用 IntersectionObserver + CSS。需要 pin、scrub、多段 timeline 或 Canvas/3D 同步时使用 GSAP ScrollTrigger。避免为了普通内容入场引入 smooth-scroll runtime。

### 角色和图标动画

已有 AE JSON / dotLottie 时使用 Lottie；已有 Rive state machine 时使用 Rive。两者是资产播放与交互方案，不替代程序化粒子系统。

## 组合规则

合理组合：

- CSS + GSAP：CSS 管简单状态，GSAP 管主时间线。
- React UI + R3F：DOM 界面和 3D scene 分层。
- Lottie/Rive + CSS：预制动画资产加轻量 UI transition。

谨慎或拒绝：

- Motion + React Spring 同时负责组件 enter/exit。
- GSAP + Anime.js 同时负责 DOM timeline。
- PixiJS + Three.js 只为两套装饰粒子。
- smooth-scroll library 与原生 scroll/ScrollTrigger 未定义唯一 ownership。

若必须组合，motion contract 必须写清每个 runtime 的唯一职责和生命周期 owner。
