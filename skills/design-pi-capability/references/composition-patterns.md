# 组合模式

pi capability 经常不是单个文件，而是多个表面协作。设计时要让每一层只承担一种职责。

## 模式一：Prompt Template + Skill

适合：用户需要低成本入口，但模型需要一套稳定方法论。

结构：

```txt
prompts/review-skill.md
skills/design-pi-capability/SKILL.md
```

分工：

- prompt template：收集参数，描述用户要做什么
- skill：提供判断框架和执行流程

避免：把 skill 的完整 checklist 复制到 prompt template。复制会导致两处内容漂移。

## 模式二：Skill + References

适合：方法论较大，但常用流程很短。

结构：

```txt
skills/foo/SKILL.md
skills/foo/references/deep-topic.md
```

分工：

- `SKILL.md`：触发条件、核心原则、短流程
- `references/`：细节、例子、边界、checklist

避免：把所有内容塞进 `SKILL.md`。pi 已经支持按需读取，不需要一开始加载所有细节。

## 模式三：Skill + Extension Tool

适合：流程中有确定性动作。

例子：设计 skill 时需要验证 frontmatter。

分工：

- skill：判断这个 capability 应该怎么设计
- tool：解析 markdown、验证字段、检查链接

避免：让模型靠肉眼检查可以程序化验证的东西。

## 模式四：Extension Command + TUI + Tool

适合：用户需要结构化交互。

例子：创建 capability 的 wizard。

分工：

- extension command：用户入口，如 `/capability-new`
- TUI：选择 capability 类型、填写 name、确认路径
- tool 或 extension 逻辑：创建文件、写 manifest、验证结构

避免：用长篇自由文本问卷代替 selector 或表单。结构化选择应该结构化呈现。

## 模式五：Context File + Skill

适合：skill 需要遵守 repo 的长期事实。

分工：

- context file：事实源，如测试命令、术语、路径约定
- skill：流程，如如何 review、如何实现、如何设计

避免：skill 复制 repo 事实。repo 事实变了以后，复制内容会过期。

## 模式六：Package as Distribution Boundary

适合：一组 capability 已经稳定，需要跨项目复用。

结构：

```txt
package.json
skills/
prompts/
extensions/
themes/
```

分工：

- package：声明资源，提供安装入口
- 资源目录：各自承担自己的职责

避免：把尚未稳定的实验过早打包成公共接口。先在项目本地跑通，再抽 package。

## 模式七：Extension + Skill 的边界

当一个能力既有方法论又有机制时，优先拆分。

例子：安全执行 shell 命令。

- skill：说明如何评估命令风险，什么时候需要询问用户
- extension：实际拦截危险命令

判断标准：

- “应该怎么判断”属于 skill
- “必须怎么执行”属于 extension

## 模式八：Router

适合：user-invoked capability 太多，用户记不住。

形态可以是：

- router skill
- prompt template，如 `/which-capability`
- extension command，如 `/capability`

优先级：

1. 少量 capability 时，不做 router。
2. 中等数量时，用 prompt template 或 skill 做 router。
3. 需要 UI 选择、状态和历史时，再做 extension/TUI router。
