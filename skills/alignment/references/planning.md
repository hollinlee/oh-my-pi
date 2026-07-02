# Planning

## 目标

在用户和 agent 已经对齐后，生成可执行但不自动执行的计划。

## 规则

- 如果没有 Alignment Brief 或 Thought Brief，先回到 `/grill`。
- 如果 readiness 为 not ready，先继续提问。
- plan 不应默认写文件或改代码。
- plan 应该小步、可验证、可停止。

## Coding/repo plan

推荐结构：

```txt
Goal
Assumptions
Vertical slices
Likely files touched
Verification commands
Risks
Rollback
Stop points
```

## 非 coding/repo plan

推荐结构：

```txt
Goal
Decision
Next actions
Trade-offs
Risks
Review point
```

## Vertical slices

每个 slice 应满足：

- 能单独完成。
- 能单独验证。
- 不依赖大量未来假设。
- 尽量减少同时修改的文件范围。

## 停止点

计划结尾必须停住，等待用户确认是否执行。
