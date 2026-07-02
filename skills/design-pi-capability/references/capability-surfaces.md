# Pi Capability 表面

pi 的 capability 不是单一文件类型，而是一组可以组合的设计表面。设计时先确认每一层的职责，避免把判断、入口、机制和分发混在一起。

## AGENTS.md / Context Files

用途：保存项目长期事实和团队约定。

适合放：

- repo 的测试命令、构建命令、发布命令
- 代码风格和工程偏好
- 项目术语和领域语言
- 不应修改的路径或敏感区域
- 长期适用的安全规则

不适合放：

- 某个一次性任务的完整计划
- 大量可按需读取的参考资料
- 需要程序强制执行的权限逻辑

判断标准：如果这是这个 repo 的长期事实，而不是某个能力的执行流程，优先放 context file。

## Prompt Templates

用途：给用户一个低成本入口，把常见请求展开成完整 prompt。

适合放：

- `/review`、`/fix`、`/explain` 这类快捷请求
- 带参数的任务入口
- 调用某个 skill 的自然语言包装
- 团队常用 prompt 格式

不适合放：

- 复杂多阶段流程
- 需要按需加载的大量参考资料
- 需要自动触发的模型行为
- 需要确定性执行的检查或外部 API 调用

判断标准：如果它只是帮用户更快发起任务，用 prompt template。

## Skills

用途：给模型一套按需加载的流程、方法论或专业知识。

适合放：

- TDD discipline
- bug diagnosis loop
- code review 标准
- domain modeling
- capability design
- release checklist 的判断逻辑

不适合放：

- 纯快捷入口
- 确定性校验逻辑
- 需要持久后台进程的能力
- 大量和当前任务无关的常驻规则

判断标准：如果模型需要“按某套方法思考和推进”，用 skill。

## Extensions

用途：改变 pi harness 的行为，或接入程序化能力。

适合放：

- 注册自定义命令
- 注册模型可调用 tool
- 拦截或修改 tool call
- 拦截 provider request
- 自定义 compaction
- 管理 session 状态
- 添加 footer、status、overlay 或复杂 TUI
- 接入 GitHub、Linear、浏览器、CI、数据库等外部系统

不适合放：

- 纯方法论
- 可以用 prompt template 表达的一次性入口
- 可以用 skill 表达的判断标准

判断标准：如果这件事必须由程序保证，或者需要改变 pi 生命周期行为，用 extension。

## Extension Tools

用途：给模型一个确定性动作，由 extension 注册并执行。

适合放：

- 解析和验证文件格式
- 查询外部 API
- 创建或更新结构化资源
- 执行有明确输入输出的操作
- 将复杂命令包装成更安全的接口

不适合放：

- 开放式判断
- 多轮讨论
- 用户意图澄清

判断标准：如果它是“给定输入，返回确定输出或执行确定动作”，做 tool。

## TUI Components

用途：提供结构化的人机交互界面。

适合放：

- selector
- confirm dialog
- multi-step wizard
- overlay 面板
- 状态看板
- 可编辑表单

不适合放：

- 无需结构化交互的普通问答
- 只为了好看而增加的界面

判断标准：如果自由文本会让交互变乱，或者用户需要选择、确认、编辑结构化数据，用 TUI。

## Themes

用途：改变 pi 的视觉风格。

适合放：

- 颜色
- 边框
- 状态显示风格

不适合放：

- 行为规则
- 工作流
- 模型指令

判断标准：如果只影响显示，不影响行为，用 theme。

## Packages

用途：分发一组相关资源。

适合放：

- prompts + skills
- extension + tools + prompts
- 团队工作流套件
- 可跨项目安装的能力包

不适合放：

- 只在当前 repo 使用的一次性文件
- 尚未稳定的方法论实验

判断标准：如果一组能力应该跨机器、跨项目、跨团队复用，用 package。

## SDK / RPC

用途：让外部系统嵌入或驱动 pi。

适合放：

- 把 pi 集成进产品
- 外部调度 agent session
- 自动化实验平台
- 自定义前端或服务端工作流

不适合放：

- 简单本地命令
- 普通 prompt 快捷方式

判断标准：如果 pi 只是更大系统中的一个组件，用 SDK/RPC。
