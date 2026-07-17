# Style Router

## Routing order

按以下优先级选择视觉方向：

1. 用户明确指定的 primary direction。
2. 用户描述的气质、产品语境、audience 和 page job。
3. repo 中已有品牌、design system 和内容结构约束。
4. Agent 基于证据选择，并在 compact design contract 中简短声明。

只有两个候选会实质改变品牌气质、信息层级或交互方式时，才问用户一个关键问题。不要为了显得周全而展示完整 catalog。

## Composition contract

- 每次恰好选择一个 primary direction。
- 每次选择零至两个 treatments；没有必要时写 `none`。
- Primary direction 决定 typography、palette character、composition、depth 和 interaction character。
- Treatment 只能调整局部材质、构图或 motion，不能覆盖主方向。
- Signature 仍然只能有一个主要焦点。
- 用户要求大量效果时，保留最服务 page job 的一至两个，其余写入 `Defaults rejected`。

## Primary directions

选择后只读取对应文件：

| Direction | 适合的核心语境 | Reference |
|---|---|---|
| `swiss-minimal` | 清晰、理性、编辑秩序、研究或专业身份 | [directions/swiss-minimal.md](directions/swiss-minimal.md) |
| `editorial` | 长内容、观点、文化、出版和叙事作品 | [directions/editorial.md](directions/editorial.md) |
| `neo-brutalist` | 挑战性、实验性、直接表达和独立创作 | [directions/neo-brutalist.md](directions/neo-brutalist.md) |
| `organic` | 自然、教育、照护、手作和生活方式 | [directions/organic.md](directions/organic.md) |
| `product-tech` | SaaS、开发工具、数据产品和技术专家 | [directions/product-tech.md](directions/product-tech.md) |
| `cinematic-luxury` | 摄影、时尚、建筑、高端作品和沉浸叙事 | [directions/cinematic-luxury.md](directions/cinematic-luxury.md) |

## Treatments

只有选中时读取对应文件：

| Treatment | 作用 | Reference |
|---|---|---|
| `glass` | 半透明层、折射边缘和悬浮材质 | [treatments/glass.md](treatments/glass.md) |
| `aurora-gradient` | 少量环境色和空间氛围 | [treatments/aurora-gradient.md](treatments/aurora-gradient.md) |
| `grain-texture` | 降低数字表面无菌感，增加印刷或影像质感 | [treatments/grain-texture.md](treatments/grain-texture.md) |
| `bento-grid` | 用不等尺寸 tile 表达真实优先级 | [treatments/bento-grid.md](treatments/bento-grid.md) |
| `kinetic-type` | 让 typography 承担一个主要 motion 时刻 | [treatments/kinetic-type.md](treatments/kinetic-type.md) |

## Personal sites and portfolios

个人网站是内容场景，不是独立风格：

- 开发者、研究者、顾问：优先比较 `swiss-minimal` 与 `product-tech`。
- 作家、记者、内容创作者：优先 `editorial`。
- 摄影师、导演、建筑或视觉作品集：优先 `cinematic-luxury`。
- 实验型独立创作者：可用 `neo-brutalist`。
- 教育、照护、自然和生活方式身份：优先 `organic`。

选择依据是用户希望访客记住什么，而不是职业标签本身。

## Routing examples

| Request | Route |
|---|---|
| “给编译器工程师做项目型个人网站” | `product-tech`，若内容更偏论文与履历则选 `swiss-minimal` |
| “给独立杂志作者做文章主页” | `editorial` |
| “给摄影师做全屏作品集” | `cinematic-luxury` |
| “给自然教育项目做主页” | `organic` |
| “明确采用 neo-brutalist” | `neo-brutalist`，用户指定优先 |
| “加一点玻璃效果” | 先选 primary direction，再按需加入 `glass` |
| “glass + bento + neon + grain + kinetic” | 只保留最服务 page job 的最多两个 treatments |
