# 能力表面决策矩阵

设计 pi capability 时，先按问题性质选择主要表面。一个能力可以组合多个表面，但必须有主次。

## 快速判断

| 问题 | 首选表面 |
| --- | --- |
| 这是 repo 的长期事实吗？ | AGENTS.md / context file |
| 这是用户常用的一句快捷请求吗？ | prompt template |
| 这是模型需要遵循的流程或方法论吗？ | skill |
| 这是必须确定执行的检查、转换或外部调用吗？ | extension tool |
| 这需要拦截 pi 生命周期或改变 harness 行为吗？ | extension |
| 这需要 selector、wizard、overlay、表单吗？ | extension + TUI |
| 这只改变视觉风格吗？ | theme |
| 这组能力要跨项目安装吗？ | package |
| 这要嵌进另一个应用或服务吗？ | SDK / RPC |

## 判断型 vs 确定型

判断型能力交给 skill。

例子：

- 判断一个 feature 应该怎么拆 vertical slice
- 判断一个 bug 是否需要先建立 repro
- 判断一个 skill 是否 context load 过高

确定型能力交给 extension/tool。

例子：

- 解析 `SKILL.md` frontmatter
- 检查 skill name 是否符合 pi 命名规则
- 查询 GitHub issue
- 阻止写入 `.env`

如果一个能力同时包含判断和确定动作，拆开：skill 负责判断，tool 负责动作。

## 一次性入口 vs 可复用流程

一次性入口用 prompt template。

例子：

- `/review-skill <path>`
- `/new-skill <name>`
- `/explain-error <command>`

可复用流程用 skill。

例子：

- 如何审查 skill
- 如何设计 pi capability
- 如何诊断 bug

prompt template 可以引导模型使用 skill，但不要把完整方法论复制进 template。

## 用户触发 vs 模型自动触发

用户显式触发：

- prompt template
- `/skill:name`
- extension command

模型按需触发：

- skill description 进入 system prompt 后，由模型决定是否读取完整 skill
- extension tool 由模型在需要确定性动作时调用

如果误触发成本高，考虑：

- 将 skill 设为 `disable-model-invocation: true`
- 使用 prompt template 或 extension command 作为唯一入口
- 收窄 description，减少泛化词

## 长期规则 vs 任务流程

长期规则放 context file。

例子：

- 本 repo 使用 `npm run typecheck`
- 不要修改生成文件
- domain term 的定义

任务流程放 skill。

例子：

- 如何做 release audit
- 如何设计 extension
- 如何从 issue 进入实现

不要把长期规则复制到每个 skill。skill 应该读取或引用 context，而不是成为第二个事实源。

## 是否需要 extension

只有出现下面至少一个条件，才优先考虑 extension：

- 需要注册 tool 或 command
- 需要拦截 input、tool call、provider request、context 或 compaction
- 需要持久 session 状态
- 需要结构化 UI
- 需要后台资源，如 server、watcher、connection pool
- 需要外部 API 或本地系统集成
- 需要安全边界由程序强制执行

否则先用 prompt template 或 skill。

## 是否需要 package

当一个能力包含多个资源，或者要跨项目复用时，做 package。

典型组合：

- `skills/` + `prompts/`
- `extension/` + `prompts/`
- `extension/` + `skills/` + `prompts/`
- `themes/` only

如果只是当前 repo 的实验，先放项目 `.pi/`。稳定后再抽成 package。
