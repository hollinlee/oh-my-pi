# Wayfinding

## 目标

Wayfinding 是 `/grill` 的内部模式，用来处理大而模糊、还不能进入 `/plan` 的问题。

它适合这种状态：用户有一个方向，但路线不清楚，无法一次 grilling 收敛，也还不能生成 execution plan。

## 触发条件

优先考虑 wayfinding mode，当任务满足多个条件：

- 问题很大或跨多个 session。
- 不知道应该先研究什么。
- 存在多个互相依赖的未知问题。
- 需要先做 Research、Prototype、Grilling 或 Task 才能看清路线。
- 还不能定义明确的 execution plan、验收标准或 GitHub issues。

继续使用 simple grilling mode，当问题可以通过少量关键问题在当前 session 内收敛。

## 私有 map

Wayfinding map 是 alignment 私有工作状态，写入：

```txt
.pi/alignment/wayfinding/<slug>.md
```

不要把 wayfinding map 写入公开项目文档。不要把 wayfinding ticket 当作 GitHub issue。

## Map 格式

```md
# Wayfinding: <title>

## Summary

Goal:
Current frontier:
Last updated:
Readiness for /plan: not-ready | partially-ready | ready

## Tickets

### <slug>: <title>

Status: open | in-progress | resolved | blocked
Type: Research | Prototype | Grilling | Task
Blocked by: <slug>, <slug>

#### Question

<question>

#### Answer

<answer>

#### Notes

<evidence, links, files, commands, discoveries>
```

## Ticket statuses

- `open`: 可以在未来推进。
- `in-progress`: 当前 session 正在推进。
- `resolved`: 已有答案。
- `blocked`: 依赖未解决，暂时不能推进。

不要在第一版引入更多状态。用 `Type`、`Answer` 和 `Notes` 表达细节。

## Ticket types

- `Research`: 需要读文档、代码、第三方 API 或其他资料。
- `Prototype`: 需要做一次性原型验证状态模型、逻辑、UI 或交互。
- `Grilling`: 需要问用户一个决策驱动的问题。
- `Task`: 需要先完成一个具体前置动作，可能由用户手动完成，也可能由工具完成。

## 创建新 map

当 `/grill` 判断新问题应进入 wayfinding mode：

1. 生成 map draft。
2. 在对话中展示 draft 和分解理由。
3. 等用户确认。
4. 确认后创建 `.pi/alignment/wayfinding/<slug>.md`。
5. 停住，不要继续推进 ticket，除非用户明确要求。

## 继续已有 map

用户可能说：

```txt
/grill 继续 wayfinding
/grill 继续 .pi/alignment/wayfinding/<slug>.md
```

处理方式：

1. 如果用户给了 map path，读取指定 map。
2. 如果没有给 map path，列出 `.pi/alignment/wayfinding/` 下的 maps，让用户选择。
3. 选择一个 unblocked open ticket。
   - 优先选择用户指定的 ticket。
   - 否则选择能解锁最多后续 tickets 的 ticket。
   - 如果影响相同，选择依赖最少、最小可解决的 ticket。
   - 如果仍然无法判断，展示候选并询问用户。
4. 标记为 `in-progress`。
5. 只推进这一个 ticket。
6. 更新 map。
7. 总结 resolved ticket、新增 ticket、当前 frontier、readiness for `/plan`。
8. 停住。

## Readiness for /plan

只有当关键未知问题已经 resolved，且目标、约束、非目标、验收标准和主要风险足够清楚时，才把 readiness 标为 `ready`。

如果只解决了一部分未知，但已经可以规划一个局部 slice，可以标为 `partially-ready` 并说明范围。

否则保持 `not-ready`。
