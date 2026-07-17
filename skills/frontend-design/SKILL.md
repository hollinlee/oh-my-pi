---
name: frontend-design
description: 为新建或重塑的网页、页面、landing page、dashboard、个人网站、作品集和视觉组件建立明确且非模板化的视觉方向。用于用户要求设计、美化、redesign、按截图或设计稿实现 UI，或明确要求视觉风格时；纯业务逻辑、状态管理、API 接入、无视觉变化的 refactor、普通 frontend bugfix 或独立 accessibility/design-system audit 不使用。
license: MIT; adapted principles acknowledge Apache-2.0 upstream in LICENSE.anthropic.txt
---

# Frontend Design

## 目标

为浏览器中的视觉产出建立与主题相符、可执行、可检查的设计方向。先决定为什么这样设计，再写 UI 代码；不要用固定 palette、字体、卡片和渐变组合替代设计判断。

## 触发边界

使用本 skill：

- 创建或重塑页面、landing page、dashboard、个人网站、作品集或视觉组件。
- 用户要求美化、提升质感、建立视觉方向或采用明确风格。
- 根据截图、设计稿或视频实现具有视觉要求的 UI。

不要使用本 skill：

- 纯业务逻辑、状态管理、API 接入或数据处理。
- 无视觉变化的 refactor、类型修复或普通 frontend bugfix。
- 独立 accessibility audit、design-system audit 或只检查合规性。

请求同时包含视觉与非视觉工作时，只把视觉决策交给本 skill，不扩大其他部分的 scope。

## 工作流

1. **读取约束**：先检查 brief、真实内容、目标受众、页面单一任务，以及 repo 中已有的品牌、tokens、components、font、icons、interaction conventions 和技术约束。现有 design system 默认优先；只有用户明确要求 redesign 时才改变基础视觉语言。能从上下文确定的信息不要重复询问。
2. **补全主题**：若主题仍模糊，选择一个具体 subject、audience 和 page job，并简短声明。只有多个方向会导致实质不同结果时才问用户一个关键问题。
3. **读取 baseline**：完整读取 [references/baseline.md](references/baseline.md)，用其约束视觉判断。
4. **选择风格**：完整读取 [references/style-router.md](references/style-router.md)，选择一个 primary direction 和零至两个 treatments。只读取被选中的 direction/treatment references，不加载完整 catalog。
5. **建立 compact design contract**：编码前产出下面五项。保持紧凑；上下文充分时它不是确认门。
6. **实现真实界面**：遵守用户指定技术栈，使用真实、具体的内容；匹配所选方向的实现复杂度。
7. **交付检查**：完整读取 [references/self-check.md](references/self-check.md)，回看 brief 和 contract，删除无意义装饰，确认 signature 仍是唯一主焦点，并按实际工具能力报告 `render-verified` 或 `code-checked`。

## Compact design contract

```md
Primary direction: <一句话描述整体视觉方向>
Treatments: <局部表现手法；没有则写 none>
Tokens: <核心色彩、字体角色、间距和深度倾向>
Signature: <唯一、与主题直接相关的记忆点>
Defaults rejected: <明确拒绝的 2–3 个模板化选择>
```

要求：

- 用户明确给出的 brief 和视觉要求优先。
- 每次恰好一个 `Primary direction`；每次零至两个 `Treatments`。
- `Primary direction` 必须描述完整视觉语言，不能只写“现代”“高级”或一个效果名。
- Treatment 不能覆盖主方向的 typography、hierarchy 或 interaction character。
- 用户明确要求 redesign 时，必须在 `Tokens` 或 `Defaults rejected` 中列出将改变的现有基础规则及替代方案。
- 品牌规范与通用 style reference 冲突时，品牌规范优先。
- `Signature` 只能有一个主要焦点；其余元素保持克制。
- `Defaults rejected` 必须说明将用什么替代，而不是只列禁词。
- 不为了展示能力而增加动画、3D、渐变、玻璃、卡片或装饰层。

## 停止条件

遇到以下情况先询问用户，不自行猜测：

- 两个视觉方向都合理，但会改变品牌气质、内容层级或交互方式。
- 用户要求与现有品牌或 design system 明显冲突，且未说明是否 redesign。
- 缺少关键素材，而不同替代策略会改变页面核心表达。

## 验证状态

- `render-verified`：只有实际使用 browser、screenshot 或等效渲染能力检查过关键 viewport 后才能使用。
- `code-checked`：只完成代码、结构和规则检查，尚未实际渲染。

没有 browser capability 时不得声称页面已经视觉验收，也不要为此自行安装 browser 工具或扩大 scope。

来源与改写边界记录在 [references/provenance.md](references/provenance.md)。
