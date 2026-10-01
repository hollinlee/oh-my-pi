# oh-my-pi

个人 pi 配置 package。它把常用的 pi extensions、skills、prompt templates 和外部集成整理成一个可安装的 package。调试类能力可以默认加载，但默认不打开 UI、不阻塞请求。

## 能力

### UI Extensions

`pi-ui-extensions` 作为 dependency 安装，随 oh-my-pi 默认加载，提供工具折叠和 diff 渲染、Markdown 增强、自定义 footer，以及 `/ccstyle` 配置入口。`cc-dark` 和 `cc-light` themes 同时注册，可在 Pi settings 中选择。

`postinstall` 和 `npm run setup` 会自动修补已知版本的历史用户消息 renderer：预留 prompt 前缀宽度、逐行限制终端宽度，并避免重复 session 包装。可用 `node scripts/patch-pi-ui-user-message.mjs apply` 手动应用；未知上游源码保持不变并报错。该修补只修改 dependency，不修改 Pi native renderer。

更新 package 后重启 Pi 或运行 `/reload` 加载 UI extension。

### MCP servers

`config/mcp.json` 声明 oh-my-pi bundled MCP servers；`extensions/mcp.js` 通过 Pi 原生 `registerMcpServer` 随 package 加载注册。`pi update --extensions` 获取包含此变更的 oh-my-pi 版本后，重启 Pi 或 `/reload` 即可加载。无需 MCP adapter 或本地 MCP npm server，也不会写入用户的 `mcp.json` / `settings.json`。

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

`append-system` 会报告 `local/native configured`、`bundled fallback active` 或 `bundled fallback disabled`。修改本地 `APPEND_SYSTEM.md` 后应运行 `/reload`，让 Pi 重新加载 native prompt。

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

不要把用户机器配置提交进 repo：

- `.pi/`：项目本地运行状态、调试输出，以及 `/grill` 维护的私有 alignment notes。
- 第三方 extensions：优先从对方的 git/npm source 安装；只有决定由本 repo 维护时才放进 `extensions/`。

## 目录结构

```txt
extensions/                 # 默认加载的稳定 extensions
  remote-devices/
  serial-devices/
  usage/
  ...

skills/                     # skills
  alignment/
  github-workflow/
  ...

prompts/                    # prompt templates

scripts/                    # 本地开发 setup/teardown
README.md                   # 能力、安装和配置说明
```
