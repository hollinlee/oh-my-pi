# Frontend Design Self-Check

这是生成流程的轻量交付检查，不是独立 design review、完整 WCAG audit 或人工视觉评审的替代品。

## Direction integrity

- 实现是否仍符合 compact design contract 的 primary direction？
- 是否只使用一个 primary direction 和最多两个 treatments？
- Treatment 是否开始主导 typography、hierarchy 或 interaction character？若是，删除或降级。
- Signature 是否仍是唯一主要记忆点，并且直接服务 subject 和 page job？
- `Defaults rejected` 中的模板选择是否悄悄回到了实现中？

## Typography and hierarchy

- Display、body、utility/data 角色是否清楚且使用一致？
- 字级、字重、行高、字距和 measure 是否形成可扫描层级？
- 是否通过 spacing 和 alignment 表达关系，而不是把所有内容包进 card？
- CTA、导航、标题、正文和 secondary metadata 的优先级是否明确？
- 文案、数字、姓名和案例是否具体可信，而非 AI placeholder？

## Layout and responsive behavior

- 检查 overflow、截断、重叠、不可达内容和意外横向滚动。
- 检查 mobile、tablet、desktop；项目已有 breakpoints 时以项目规则为准。
- 建议缺省 viewport：约 `375px`、`768px`、`1440px`。
- DOM 顺序在 grid、bento、跨栏或视觉重排后是否仍合理？
- 媒体是否有稳定尺寸、裁切策略和避免 layout shift 的处理？
- Touch target、sticky、fixed 和 hover-only interaction 在小屏是否可用？

## Interaction states

按组件实际职责检查必要状态：

- hover、focus-visible、active、disabled。
- loading、empty、error、success。
- 表单 validation 和提交反馈。
- 导航当前位置、展开/收起和 modal/dialog focus behavior。

不要为了 checklist 虚构产品不需要的状态。

## Basic accessibility

- 使用 semantic HTML；交互元素可通过 keyboard 操作。
- Focus indicator 清楚且不被 clipping、overlay 或透明 surface 隐藏。
- 文字和关键控件具有足够 contrast；状态不只靠颜色表达。
- 正文字号、行高和 target size 不因视觉方向而牺牲可用性。
- 图片、图表和 icon 有与用途匹配的文本替代或隐藏策略。
- Motion 尊重 `prefers-reduced-motion`，关键内容不依赖动画完成后才出现。
- Glass、gradient、texture 和媒体叠层提供稳定可读的 fallback。

## Generic AI pattern check

主动寻找并删除：

- 与主题无关的 gradient、glow、glass、noise、floating orb 或 cursor effect。
- 重复的 card-border-shadow section。
- 三张同质 feature cards、虚构 metrics 和模板 testimonial。
- 所有 section 都使用相同宽度、对齐、圆角和 reveal 节奏。
- 只有装饰意义的 `01/02/03`、eyebrow、badge 和 icon。
- 同时竞争的多个 signature effects。

## Existing system boundary

- 已有品牌规范、tokens、components、font、icons 和 interaction conventions 默认优先。
- 普通视觉实现应在现有系统内表达 direction，不擅自替换基础语言。
- 只有用户明确要求 redesign 时才改变基础规则。
- Redesign 的 compact design contract 必须在 `Tokens` 或 `Defaults rejected` 中列出要改变的现有规则及替代方案。
- 品牌规则与通用 style reference 冲突时，以品牌规则为准。

## Verification status

交付时只能选择以下状态之一：

### `render-verified`

仅当实际使用 browser、screenshot 或等效渲染能力检查过关键 viewport 后使用。说明检查的 viewport、主要状态和发现/修复的问题。

### `code-checked`

没有可用 browser capability，或本次未进行实际渲染时使用。说明已完成代码、结构和规则检查，但视觉结果尚未经过实际浏览器验证。

禁止：

- 未渲染时声称“视觉验收通过”“页面显示正常”或使用 `render-verified`。
- 因缺少 browser tool 而偷偷安装 Playwright、启动外部服务或扩大任务 scope。
- 把 `code-checked` 描述成与实际渲染等价。
