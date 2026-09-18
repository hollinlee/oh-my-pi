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

任务大而模糊、且探索目标可独立拆分时（例如同时需要“相似功能怎么实现”“涉及的架构层”“验证入口在哪”），先列出 **2–3 个探索角度**，再按角度依次执行。

### 何时并行

`subagent_batch` 已启用（`OH_MY_PI_SUBAGENT_ENABLED=1`）且角度之间无依赖时，可以用 bounded read-only nodes 并行探索：

- 每个节点只使用 `read-only` profile。
- 每个节点有明确的 objective、scope、acceptance criteria 和 expected output。
- parent 汇总各节点结果后再决定下一步；不自动扩图、不追加节点。
- 总节点数不超过探索角度数（最多 3）。

### 顺序 fallback

`subagent_batch` 不可用、角度之间有依赖、或任务窄到不值得并行时，按同一份角度提纲顺序探索。并行与否不改变提纲本身。

### 边界

- 窄任务（用户已指明文件/目录）不列提纲、不并行，直接按“优先级”执行。
- 并行只用于只读探索；任何写操作、修改或实现都不走 subagent 探索路径。
- 无论顺序还是并行，都遵守“足够即停”，不为凑满角度而多读。

## 不做

- 不默认读取秘密文件，如 `.env`、auth、keychain 输出。
- 不把 `.pi/alignment` 内容复制到 tracked files。
- 不创建公开 context 文档。
