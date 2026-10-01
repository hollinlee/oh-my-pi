# oh-my-pi

个人 pi 配置 package。它把常用的 pi extensions、skills、prompt templates 和外部集成整理成一个可安装的 package。调试类能力可以默认加载，但默认不打开 UI、不阻塞请求。

## 能力

### 本地控制台

`/oh-my-pi` 提供一个本地能力控制台，用来查看和进入常用配置入口：

- Tools：查看并启用/禁用当前 tools，状态随 session branch 恢复。
- Commands：查看当前 extension command、prompt template 和 skill command。
- Skills：查看 skill commands。
- Extensions：按来源 path 查看 extension 暴露的 commands。
- Remote devices：查看 remote-devices command/tools 是否已加载。
- RTK setup：手动重跑 `rtk init -g --agent pi`。


也支持少量参数直达：

```txt
/oh-my-pi tools
/oh-my-pi commands
/oh-my-pi skills
/oh-my-pi extensions
/oh-my-pi remote
/oh-my-pi rtk

```

### UI Extensions

`pi-ui-extensions` 作为 dependency 安装，随 oh-my-pi 默认加载，提供工具折叠和 diff 渲染、Markdown 增强、自定义 footer，以及 `/ccstyle` 配置入口。`cc-dark` 和 `cc-light` themes 同时注册，可在 Pi settings 中选择。

更新 package 后重启 Pi 或运行 `/reload` 加载 UI extension。

### Context7 MCP

`config/mcp.json` 声明 Context7；`extensions/context7.js` 通过 Pi 原生 `registerMcpServer` 随 package 加载注册。`pi update --extensions` 获取包含此变更的 oh-my-pi 版本后，重启 Pi 或 `/reload` 即可加载。无需 MCP adapter 或本地 Context7 npm server，也不会写入用户的 `mcp.json` / `settings.json`。

代码实现需要第三方库 API、配置或版本文档时按需查询 Context7，先匹配项目依赖版本。两个文档 tools 默认直接暴露。可选环境变量 `CONTEXT7_API_KEY` 会作为请求 header 传入；未设置时不发送该 header，实际可用额度取决于 Context7 服务策略。

在 `/mcp` 查看连接状态。个人或项目 `mcp.json` 中同名 `context7` 条目优先，可覆盖凭据、exposure 或设置 `enabled: false`；`pi mcp list` 不加载 extensions，因此不会列出此 package 注册的 server。需要支持 `registerMcpServer` 的 Pi；旧版本仅提示升级。

### APPEND_SYSTEM 安装与更新

package 的 `postinstall` 和 `npm run setup` 会尝试把 package 内的 `system/APPEND_SYSTEM.md` 安装到 `~/.pi/agent/APPEND_SYSTEM.md`，因此 `pi update --extensions` 后会自动同步 oh-my-pi managed prompt。安装使用 managed marker 和幂等更新：不存在时创建，已有 oh-my-pi managed 文件时更新；已有非 managed 用户文件保留并报告 conflict，不覆盖。冲突时继续完成 package 安装，但 oh-my-pi bundled prompt 不会替换用户 prompt。

human-facing APPEND_SYSTEM 包含主 agent 的 `ask_user` blocking-decision 规则和 subagent delegation policy。subagent child 使用独立 child-specific system prompt，不继承这份面向人的 APPEND_SYSTEM。

### APPEND_SYSTEM fallback

Pi 原生加载受信任项目的 `.pi/APPEND_SYSTEM.md`，否则加载用户配置目录中的 `APPEND_SYSTEM.md`（默认 `~/.pi/agent/APPEND_SYSTEM.md`）。oh-my-pi 尊重这个优先级：只要 Pi 已配置 native/project/CLI append，就不会重复注入；没有任何 native append 时，才追加 package 内的 `system/APPEND_SYSTEM.md`。

内置 fallback 是公开、可版本控制的默认个人交流规则，不会写入或覆盖用户配置。可通过环境变量禁用：

```bash
export OH_MY_PI_APPEND_SYSTEM_DISABLED=1
```

`/oh-my-pi doctor` 会报告 `local/native configured`、`bundled fallback active` 或 `bundled fallback disabled`。修改本地 `APPEND_SYSTEM.md` 后应运行 `/reload`，让 Pi 重新加载 native prompt。

### Usage dashboard

`/usage` 打开全屏本地 usage dashboard。它从现存 Pi session JSONL 和临时 session 的本地 intake journal 汇总 accounting metadata，并提供 Today、7 days、30 days 三个范围。

```txt
/usage
/usage purge
```

Dashboard 按键：`1` Today、`2` 7 days、`3` 30 days、`Tab` 切换 Models/Providers/Projects breakdown、`r` 重新扫描、`p` 清除 usage 数据、`Esc` 关闭。`Total` 是 input、output、cache read、cache write token 的总和；`Cost` 直接累计 session/intake 中已记录的 `usage.cost.total`。该值通常由 Pi 在请求完成时按当时的 model cost metadata 计算；dashboard 不按当前价格表重算历史。

所有数据仅保存在本机，默认位于 `~/.pi/agent/usage/`。ledger 只保存时间、operation、provider、model、project path、token/cost/response 计数和不可逆事件/源标识；不会保存 prompt、assistant content、thinking、tool arguments/output 或 session 正文。删除 Pi session file 不会自动删除已经采集的 ledger 历史，这样历史统计不会因 session 清理而变化。

`/usage purge` 和 dashboard 的 `p` 都会再次确认。确认后只删除 usage 自有的 SQLite ledger、WAL/SHM 和 intake journal，并重建空 schema；不会删除或修改任何 Pi session file，也不会递归删除 usage state directory。随后 `r` 可重新采集仍存在的 sessions；已经删除的 source session 历史无法恢复。

### Remote devices

`extensions/remote-devices` 注册远程设备管理 tools 和本地命令：

```txt
/remote-devices list
/remote-devices probe
/remote-devices test <device>
```

模型可调用 tools：

- `remote_list_devices`
- `remote_resolve_device`
- `remote_exec`
- `remote_exec_batch`
- `remote_probe_devices`
- `remote_test_connection`
- `remote_add_device`
- `remote_learn_alias`
- `remote_install_keys`

默认设备配置写入 `~/.pi/agent/remote-devices/devices.json`。package 内只带空 seed，不包含真实主机；`skills/remote-devices` 负责告诉模型优先使用这些 tools，而不是手写 `ssh` 命令。

### Web Access

通过 `npm:@juicesharp/rpiv-web-tools` 提供 web search 和 fetch 能力。支持 Brave、Tavily、Serper、Exa、You.com、Jina、Firecrawl、Perplexity、SearXNG、Ollama 等 provider。

### Alignment / planning

`skills/alignment` 用来把模糊想法、个人问题、设计讨论或 coding/repo 任务先拷问清楚，再决定是否进入计划。coding/repo 的 `/plan` 会在同一轮生成 plan 与 GitHub issue drafts，共用一次创建确认。

常用入口：

```txt
/grill <想法/问题/任务>
/plan <任务或已对齐内容>
```

`/grill` 会先判断是否 coding/repo 相关。非 coding/repo 时只帮你想清楚；coding/repo 时可以读取相关 repo 文件，并维护私有工作记忆：

```txt
.pi/alignment/
```

这些私有 context、glossary、brief 和 ADR 不会写入公开项目文件，也不会被 tracked files 引用。Wayfinding ticket resolved 后会直接进入下一个关键问题，不需要额外回复“继续”；详细状态默认只写入私有 map，不在每轮重复展开。

### GitHub workflow

`skills/github-workflow` 用来把已确认的计划推进到 GitHub issue/PR 工作流。第一版使用 skill + prompt templates + `gh` CLI，不做 GitHub extension/tool。

常用入口：

```txt
/to-issues <计划或范围>
/work-issue <issue-number-or-url> [更多 issue...]
/ship-changes [改动说明]
/create-pr <issue-number-or-url 可选>
/handle-review <pr-number-or-url 可选>
/merge-pr <pr-number-or-url 可选>
```

默认链路：

```txt
/grill -> /plan + issue drafts -> confirm/create issues -> /work-issue 51 52 53
```

`/to-issues` 保留为已有 plan 或显式范围的 standalone/recovery entry。

`/ship-changes` 用于代码已经做完、但尚未建立 issue/PR 的 recovery 场景。它根据当前 diff/commits 反向生成单个 issue draft；用户确认一次后，自动补建 issue，并继续 branch、verification、commit、PR、review 和 squash merge。需要重写 base branch 历史或改动无法归属时会停止。

`/work-issue` 只处理显式给出的有序队列。对每个 issue 自动完成 implementation、verification、commit、PR creation、review handling 和 squash merge；当前 issue merge 并同步 `main` 后才处理下一个。Runtime guard 使用 `work_issue_checkpoint` 持久化队列状态；没有 human decision gate 时，agent 在中间 artifact 后普通停止会自动续跑。

规则：

- issue/PR 默认中文，技术标识保留英文。
- issue/PR 不得引用 `.pi/alignment`。
- 一个 issue 默认是一个 vertical slice 和一个 PR。
- coding/repo 的 `/plan` 同一轮展示 plan 与 issue drafts，只确认一次；确认后创建 issues 并输出 `/work-issue` 队列，但不自动执行。
- `/to-issues` 作为 standalone/recovery entry 采用相同的一次确认规则。
- `/work-issue` 调用本身授权显式队列的 branch、commit、push、PR、review reply 和 merge，不重复请求确认。
- `/ship-changes` 在展示已有改动对应的 issue draft 后只确认一次；确认同时授权 issue creation 和后续 PR-to-merge 链路。
- scope change、审美/API 取舍、安全风险、无法归属的改动、非唯一失败修复或无法消除的 merge blocker 会暂停整个队列。
- `/create-pr`、`/handle-review`、`/merge-pr` 是 autopilot 的后续阶段恢复入口：分别从已有 issue 的 PR creation、review、merge 阶段开始，并在无 human decision gate 或 blocker 时自动推进到 merge。
- merge 默认 squash merge + delete branch，且始终检查 authoritative blocking conditions。

### Capability 设计 skill

`skills/design-pi-capability` 用来设计、审查或重构 pi capability，判断一个工作流应该放在 skill、prompt template、extension、tool、TUI、context file、package、SDK/RPC 或 theme 的哪一层。

常用入口：

```txt
/skill:design-pi-capability
/design-capability <目标或场景>
/review-capability <路径>
/new-skill <skill-name> <目标>
/port-capability <来源路径或说明>
```



### Provider payload inspector

`pi-prompt-intercept` 作为 dependency 安装，并随 root package 默认加载，提供：

```txt
/prompt-intercept
```

默认不会打开浏览器 UI，也不会阻塞 request。需要检查 provider payload 时运行：

```txt
/prompt-intercept open
```

它会打开本地 UI，用 pass-through capture 记录 provider request；需要时可以切到 intercept 模式查看、编辑、放行或丢弃 pending request。

### rtk

`rtk` 不是本 repo 的 extension 文件。它由上游 CLI 通过下面的命令写入全局 pi 配置：

```bash
rtk init -g --agent pi
```

`npm run setup` 会默认尝试执行一次。如果跳过、失败或本机还没安装 rtk，可直接使用 `pi-rtk-adapter` 提供的命令完成初始化。

## 安装

全局日常使用时，通过 pi package manager 从 git 安装：

```bash
pi install git:github.com/ichigyu/oh-my-pi
```

安装或修改配置后，重启 pi，或在 pi 内运行：

```txt
/reload
```

## 本地开发

开发当前 checkout 时，用脚本把当前目录注册到全局 pi settings：

```bash
npm run setup
```

`setup` 会：

- 把当前 repo root 加到 `~/.pi/agent/settings.json#packages`。
- 默认尝试执行 `rtk init -g --agent pi`。

通过 Pi package manager 安装或更新 oh-my-pi 时，package 的 `postinstall` 会同步 managed `APPEND_SYSTEM.md`。`oh-my-pi` 不再修改 Pi native renderer；需要 native transcript 时直接使用 Pi 原生实现。

跳过 rtk 初始化：

```bash
OH_MY_PI_SKIP_RTK=1 npm run setup
```

移除开发注册：

```bash
npm run teardown
```

## 文件归属

放进 package manifest 的内容，应该是可复用、可加载的能力：

- `extensions/`：本 repo 维护的稳定 first-party extensions。
- `skills/`：可复用 skills。
- `prompts/`：prompt templates。
- `pi-prompt-intercept`：默认加载的独立 package，通过 dependency 安装；本 repo 的 `packages/pi-prompt-intercept/` 仅作为开发用 submodule。

不要把用户机器配置提交进 repo：

- `.pi/`：项目本地运行状态、调试输出，以及 `/grill` 维护的私有 alignment notes。
- 第三方 extensions：优先从对方的 git/npm source 安装；只有决定由本 repo 维护时才放进 `extensions/`。

## 目录结构

```txt
extensions/                 # 默认加载的稳定 extensions
  oh-my-pi.ts
  remote-devices/
  serial-devices/
  status-bar.ts
  usage/
  ...

skills/                     # skills
  alignment/
  design-pi-capability/
  diagnosing-bugs/
  github-workflow/
  ...

prompts/                    # prompt templates

packages/                   # 开发用 submodules
  pi-prompt-intercept/

scripts/                    # 本地开发 setup/teardown
README.md                   # 能力、安装和配置说明
```
