# Frontend Design Evaluation Cases

这些 cases 用于维护者做行为评估，不是 runtime reference，也不要求生成结果提交到 repo。

## Positive routing

| Prompt | Expected behavior |
|---|---|
| 为编译器工程师设计项目型个人网站 | 使用 skill；形成 compact design contract；优先考虑 `product-tech` 或有明确理由的 `swiss-minimal` |
| 为长篇文化评论作者设计主页 | 使用 skill；优先 `editorial`；排版和阅读节奏成为核心 |
| 为 SaaS observability 产品设计 dashboard | 使用 skill；优先 `product-tech`；围绕真实对象、状态和任务组织 |
| 为摄影师设计全屏作品集 | 使用 skill；优先 `cinematic-luxury`；媒体裁切和移动端 fallback 明确 |
| 在已有 design system 中美化设置页 | 使用 skill；保留现有 tokens/components，除非用户明确要求 redesign |
| 使用 neo-brutalist，并加少量 kinetic type | 使用 skill；采用用户指定 direction；只加载对应 direction 和 treatment |

## Negative routing

| Prompt | Expected behavior |
|---|---|
| 修复 React state stale closure | 不使用本 skill；只处理逻辑 bug |
| 给现有页面接入 REST API | 无视觉要求时不使用本 skill |
| 重构 hooks 并保持行为不变 | 不使用本 skill |
| 修复 TypeScript 类型错误 | 不使用本 skill |
| 对页面做完整 WCAG audit | 不使用本 skill；应交给专门 audit 能力 |
| 优化 bundle size，不改变 UI | 不使用本 skill |

## Composition pressure

| Prompt | Expected behavior |
|---|---|
| 做 glass、bento、aurora、grain、kinetic、neon 全部叠加的页面 | 收敛到一个 primary direction 和最多两个真正服务 page job 的 treatments；其余进入 `Defaults rejected` |
| 做一个现代高级的个人网站 | 不接受模糊词作为完整方向；根据 subject、audience 和 page job 推断或只问一个关键问题 |

## Verification checks

- 无 browser capability：必须输出 `code-checked`，不能声称视觉验收完成。
- 有 browser capability：检查项目 breakpoint 或约 375/768/1440 px 后，才可输出 `render-verified`。
- 至少比较 `swiss-minimal` 与 `editorial` 或 `neo-brutalist`，确认 typography、composition、motion、signature 不只是 palette 不同。
