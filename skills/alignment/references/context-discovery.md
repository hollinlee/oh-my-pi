# Context Discovery

## 目标

只读取足够回答问题的 repo 上下文。不要为了显得努力而全仓库漫游。

## 优先级

1. 用户直接提到的文件、命令或目录。
2. Root metadata：`README.md`、`package.json`、manifest、配置文件。
3. 与任务关键词匹配的源码。
4. `.pi/alignment/` 中已有私有 context、glossary、ADR。
5. 最近相关测试或验证命令。

## 读取策略

- 先用搜索定位，再读文件。
- 读到足够形成问题或判断时停止。
- 对不确定的事实标注“不确定”，不要编造。
- 如果发现代码和用户描述冲突，立刻指出并询问。

## 复杂 repo 任务的探索策略

对于范围较大或问题模糊、但可以拆成彼此独立且各自在一次 dispatch 内完成的小型只读探索单元的任务，先定义 **2–3 个探索角度**。例如分别探索相似实现、架构边界和验证入口。whole-repo、corpus、长文分析，或需要 parent 吸收中间证据后再调整范围的任务，不适合一次 `subagent_batch`；改用 parent 分轮调用单个 `subagent`，每轮汇总后再决定下一步。

### 何时并行

只有在 `subagent_batch` capability 已实际注册且 dispatch 可以成功、探索角度彼此无依赖、任务不是上述需要逐步判断的类型时，才可以用 bounded read-only nodes 并行探索。`OH_MY_PI_SUBAGENT_ENABLED=1` 只是启用前提，不等于 capability 一定可用；如果 dispatch 返回 blocked、unsupported 或其他 failure，立即使用顺序 fallback：

- 每个节点只使用 `read-only` profile。
- 每个节点有明确的 objective、scope、acceptance criteria 和 expected output。
- parent 汇总各节点结果后再决定下一步；不自动扩图、不追加节点。
- 总节点数不超过探索角度数（最多 3）。

### 顺序 fallback

`subagent_batch` 未注册、不可调用或 dispatch 失败，角度之间有依赖，或任务复杂但不适合并行时，按同一份角度提纲顺序探索。需要逐步吸收证据或调整范围时，parent 每轮只调用一个 `read-only` subagent，汇总后再决定下一轮；不需要 child 时直接由 parent 顺序读取。窄任务始终跳过提纲和 fallback，直接按“优先级”执行。

### 边界

- 窄任务按范围和目标是否足够小判断，不以用户是否指定文件或目录判断；用户指定的大型目录仍可能属于复杂任务。
- `subagent_batch` 只用于已经拆好的、小型、彼此独立的只读探索；任何写操作、修改或实现都不走并行探索路径。
- 无论顺序还是并行，都遵守“足够即停”，不为凑满角度而多读，也不做无目的全仓库漫游。

## 不做

- 不默认读取秘密文件，如 `.env`、auth、keychain 输出。
- 不把 `.pi/alignment` 内容复制到 tracked files。
- 不创建公开 context 文档。
