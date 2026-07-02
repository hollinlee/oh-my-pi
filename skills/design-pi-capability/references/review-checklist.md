# 审查清单

用这份清单审查任何 pi capability 设计。

## 一、表面选择

- 这个能力的主要表面是否选对了？
- 是否把判断型内容放进 skill？
- 是否把快捷入口放进 prompt template？
- 是否把确定性机制放进 extension/tool？
- 是否把项目长期事实放进 context file？
- 是否只有在需要跨项目复用时才做 package？

危险信号：

- 为了一个普通 prompt 写 extension
- 把大量项目事实复制进 skill
- 让模型自由执行本该由 tool 验证的检查
- 一个 prompt template 里塞了完整方法论

## 二、职责边界

- 每个 artifact 是否只承担一种主要职责？
- 是否存在同一规则在多个地方重复？
- 如果规则变化，事实源在哪里？
- 用户入口、模型流程、确定性动作是否分清楚？

危险信号：

- prompt template 和 skill 内容大段重复
- extension 里写了大量自然语言方法论
- skill 里硬编码某个 repo 的测试命令
- package 里资源很多，但没有共同主题

## 三、认知负担

- 用户需要记住多少命令？
- 常用入口是否有 prompt template 或 extension command？
- capability 名字是否短、准确、可搜索？
- 是否需要 router？如果需要，router 本身是否足够简单？

危险信号：

- 用户必须记一串相似的 skill 名称
- 命名抽象但不说明场景
- 同一任务有多个入口，用户不知道该用哪个

## 四、上下文负担

- skill description 是否具体，避免过宽触发？
- `SKILL.md` 是否只放执行主线？
- 大块参考内容是否移到 `references/`？
- 不常用或误触发成本高的 skill 是否应禁用 model invocation？

危险信号：

- description 写成“helps with development”这类泛化句
- `SKILL.md` 超长，混合流程、参考、例子和历史说明
- 每次任务都把不相关规则塞进 system prompt

## 五、可执行性

- 用户给一个真实场景时，agent 是否知道第一步做什么？
- 是否定义了完成标准？
- 是否说明何时停止、何时询问用户？
- 是否避免“做得更好”这种不可执行指令？

危险信号：

- 只有价值观，没有步骤
- 步骤过细，导致模型机械执行而不能判断
- 缺少失败模式和边界条件

## 六、协作设计

参考 [workflow design principles](workflow-design-principles.md)。

- 用户看到的是可判断产出，还是 AI 的劳动过程？
- 是否把搜索、比较、整理等脏活转化成 artifact、结论、风险、验证或明确排除项？
- AI 主动性是否随任务复杂度和决策风险递减？
- capability 是否写清楚直接做、确认边界、按计划停住、先对齐这几类情况？
- 需要人的地方是否表达为“当前需要用户判断什么”？
- 这些原则是否只引用这一份 reference，避免复制到其他 workflow？

危险信号：

- 用文件数、搜索轮数、阅读量包装价值
- 高风险 workflow 默认自动执行到底
- 把“human-in-the-loop”当流程标签，而不是提出可回答的问题
- 在多个 skill 中复制同一组协作原则

## 七、安全和权限

- extension 是否真的需要系统权限？
- tool 是否限制了输入和输出？
- 是否避免默认写敏感路径？
- 是否在危险动作前确认？
- package 是否提醒用户审查代码？

危险信号：

- extension 做了文件写入但没有说明范围
- tool 接收任意 shell 命令
- TUI 操作没有取消路径
- package 自动加载太多有副作用资源

## 八、演进策略

- 第一版是否足够小？
- 是否先用 prompt/skill 验证方法，再写 extension？
- 是否能从项目本地资源平滑升级为 package？
- 是否有明确的下一步，而不是一次性做完整平台？

危险信号：

- 还没验证 workflow 就开始做复杂 TUI
- 一开始就做全量 package + extension + tools
- 没有真实任务驱动设计
