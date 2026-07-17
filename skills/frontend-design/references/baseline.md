# Frontend Design Baseline

## 从主题出发

先明确三个事实：设计对象是什么、主要服务谁、页面最重要的一件事是什么。视觉语言应来自主题自身的材料、工具、环境、历史和词汇，而不是来自 agent 常用模板。

缺少真实内容时，补写具体、可信且符合场景的内容。避免 `Acme`、`John Doe`、整齐的虚构指标，以及“Elevate”“Seamless”“Unlock”一类无信息量文案。

## Hero 表达核心命题

首屏应让用户立即理解页面为何存在。Hero 可以是标题、作品、交互、数据或图像，但必须直接表达主题。不要无条件使用“大标题 + 三个指标 + 渐变 CTA”结构。

## Typography 建立身份

- 为 display、body、utility/data 等角色选择明确的字体和字级关系。
- 字重、字宽、行高、字距和段落宽度必须共同表达气质。
- 不要因为某个字体流行或方便就反复用于所有主题。
- 极简方向依赖排版和间距精度，不能用“少放内容”冒充设计。

## Structure 承载信息

Grid、编号、eyebrow、分隔线、标签和卡片必须解释内容关系。只有真实顺序才使用步骤编号；只有需要独立分组时才引入容器。优先通过间距、对齐和层级表达关系，不要把所有内容包进同质卡片。

## Color 与 surface 有具体理由

Palette 应来自主题及品牌约束，并为背景、文本、强调、状态和 surface 分配清晰职责。避免默认紫色渐变、任意 neon、高密度玻璃卡片和没有信息意义的彩色光晕。

Depth 应保持一致。边框、阴影、模糊和叠层需要形成同一种物理或图形逻辑，不能逐组件随机选择。

## Motion 服务一个时刻

先决定页面是否真的需要 motion。若需要，选择一个主要编排时刻，例如进入、滚动叙事或关键交互反馈；其余动画保持克制。尊重 reduced-motion，避免散落的 reveal 和 hover 动画让页面失去节奏。

## Complexity 匹配方向

- Maximal direction 需要足够的构图、素材和交互执行，不能只堆效果。
- Minimal direction 需要精确的 typography、spacing、alignment 和细节。
- 不要把实现复杂度误当成设计质量。

## Signature 与克制

每个页面只设一个主要 signature：它应与产品主题直接相关，并能解释为何这个页面不同。Signature 可以是结构、视觉、内容或交互，不必是特效。

确定 signature 后，主动削弱周围竞争元素。删除不能服务 brief、层级或交互的装饰。

## Anti-template check

编码前明确拒绝 2–3 个对当前场景最显而易见的模板选择，并说明替代方案。重点检查：

- 是否无理由采用熟悉的字体、palette 或 hero。
- 是否大量重复 card-border-shadow 组合。
- 是否用图标和装饰替代信息层级。
- 是否所有 section 都使用相同宽度、对齐和节奏。
- 是否文案、数字和姓名看起来像占位符。
- 是否加入与主题无关的 gradient、glass、noise、cursor 或 motion。

最终判断标准不是“看起来像设计网站”，而是视觉选择是否只能合理地属于这个 subject、audience 和 page job。
