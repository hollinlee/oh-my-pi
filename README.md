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
- Model relays：进入模型中转站/provider 配置向导。
- RTK setup：手动重跑 `rtk init -g --agent pi`。
- MinerU：配置、查看或撤销云端文档解析授权。
- Tavily status：查看 Tavily key pool 状态。

也支持少量参数直达：

```txt
/oh-my-pi tools
/oh-my-pi commands
/oh-my-pi skills
/oh-my-pi extensions
/oh-my-pi remote
/oh-my-pi relays
/oh-my-pi rtk
/oh-my-pi mineru
/oh-my-pi tavily
```

### 模型中转站/providers

`/model-relay-add` 提供交互式向导，用来生成或更新 `~/.pi/agent/models.json`。

支持把 API key 配置为：

- 省略，使用 `/login`、`auth.json` 或启动参数。
- 直接写入 `models.json`。
- 从环境变量读取。
- 从 macOS Keychain 读取。

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

### MinerU 配置与授权

`/mineru` 管理 MinerU Precision API 的本地 token 和持久云端上传授权：

```txt
/mineru setup
/mineru status
/mineru revoke
```

Token 优先从 `MINERU_TOKEN` 读取，未设置时读取 macOS Keychain service `pi-tool-api-key-mineru`。Token 不写入 `~/.pi/agent/mineru/config.json`；该文件只保存非敏感授权 marker。配置时会明确披露文件发送到 `mineru.net`、服务端可能保留最多 30 天，以及本地 timeout/cancel 不保证停止远端任务。

首次 setup 可先临时提供环境变量，命令会在 macOS 上把 token 写入 Keychain：

```bash
MINERU_TOKEN='<MINERU_TOKEN>' pi
```

如需紧急禁用 capability：

```bash
export OH_MY_PI_MINERU_DISABLED=1
```

当前阶段只提供配置、状态和撤销；文档上传 tool 将在后续 capability slice 中加入。

### Tavily tools

`extensions/tavily-tools.ts` 注册模型可调用 tools：

- `tavily_search`
- `tavily_extract`

并提供命令：

```txt
/tavily-pool-status
```

它支持多个 Tavily API keys、Keychain 自动发现、并发限制和 cooldown。

### Alignment / planning

`skills/alignment` 用来把模糊想法、个人问题、设计讨论或 coding/repo 任务先拷问清楚，再决定是否进入计划。

常用入口：

```txt
/grill <想法/问题/任务>
/plan <任务或已对齐内容>
```

`/grill` 会先判断是否 coding/repo 相关。非 coding/repo 时只帮你想清楚；coding/repo 时可以读取相关 repo 文件，并维护私有工作记忆：

```txt
.pi/alignment/
```

这些私有 context、glossary、brief 和 ADR 不会写入公开项目文件，也不会被 tracked files 引用。

### GitHub workflow

`skills/github-workflow` 用来把已确认的计划推进到 GitHub issue/PR 工作流。第一版使用 skill + prompt templates + `gh` CLI，不做 GitHub extension/tool。

常用入口：

```txt
/to-issues <计划或范围>
/work-issue <issue-number-or-url> [更多 issue...]
/create-pr <issue-number-or-url 可选>
/handle-review <pr-number-or-url 可选>
/merge-pr <pr-number-or-url 可选>
```

默认链路：

```txt
/grill -> /plan -> /to-issues -> /work-issue 51 52 53
```

`/work-issue` 只处理显式给出的有序队列。对每个 issue 自动完成 implementation、verification、commit、PR creation、review handling 和 squash merge；当前 issue merge 并同步 `main` 后才处理下一个。

规则：

- issue/PR 默认中文，技术标识保留英文。
- issue/PR 不得引用 `.pi/alignment`。
- 一个 issue 默认是一个 vertical slice 和一个 PR。
- `/to-issues` 仍先展示 drafts，确认后创建，并输出可复制的 `/work-issue` 队列。
- `/work-issue` 调用本身授权显式队列的 branch、commit、push、PR、review reply 和 merge，不重复请求确认。
- scope change、审美/API 取舍、安全风险、无法归属的改动、非唯一失败修复或无法消除的 merge blocker 会暂停整个队列。
- `/create-pr`、`/handle-review`、`/merge-pr` 是 autopilot 的阶段恢复入口：分别从 PR creation、review、merge 阶段开始，并在无 human decision gate 或 blocker 时自动推进到 merge。
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

`npm run setup` 会默认尝试执行一次。如果跳过、失败或本机还没安装 rtk，可以安装后在 pi 内运行：

```txt
/oh-my-pi rtk
```

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

跳过 rtk 初始化：

```bash
OH_MY_PI_SKIP_RTK=1 npm run setup
```

移除开发注册：

```bash
npm run teardown
```

## Pi 空 assistant comment 兼容补丁

部分 Pi 版本会为只包含空 HTML comment 的 assistant message 渲染空行。oh-my-pi 提供显式、版本/source-marker guarded 的 compatibility script；`setup` 不会自动修改 Pi 安装目录。

```bash
npm run pi-empty-comments -- status
npm run pi-empty-comments -- apply
npm run pi-empty-comments -- restore
```

`apply` 会先创建 backup 和 checksum metadata；source marker 不匹配时拒绝修改。`restore` 只在当前文件和 backup checksum 都匹配时恢复。优先使用上游 Pi 修复；该脚本仅作为本地 compatibility fallback。

## 配置 Tavily

推荐使用 macOS Keychain：

```bash
security add-generic-password -a "$USER" -s pi-tool-api-key-tavily -w '<TAVILY_API_KEY>' -U
```

多个 key 使用编号服务名：

```bash
security add-generic-password -a "$USER" -s pi-tool-api-key-tavily-2 -w '<TAVILY_API_KEY_2>' -U
security add-generic-password -a "$USER" -s pi-tool-api-key-tavily-3 -w '<TAVILY_API_KEY_3>' -U
```

也可以使用环境变量：

```bash
export TAVILY_API_KEY='<TAVILY_API_KEY>'
export TAVILY_API_KEYS='<KEY_1>,<KEY_2>'
```

## 文件归属

放进 package manifest 的内容，应该是可复用、可加载的能力：

- `extensions/`：本 repo 维护的稳定 first-party extensions。
- `skills/`：可复用 skills。
- `prompts/`：prompt templates。
- `pi-prompt-intercept`：默认加载的独立 package，通过 dependency 安装；本 repo 的 `packages/pi-prompt-intercept/` 仅作为开发用 submodule。

不要把用户机器配置提交进 repo：

- `~/.pi/agent/models.json`：由 `/model-relay-add` 在本机生成，可能包含 provider 配置或 key 引用。
- `.pi/`：项目本地运行状态、调试输出，以及 `/grill` 维护的私有 alignment notes。
- 第三方 extensions：优先从对方的 git/npm source 安装；只有决定由本 repo 维护时才放进 `extensions/`。

## 目录结构

```txt
extensions/                 # 默认加载的稳定 extensions
  oh-my-pi.ts
  model-relay.ts
  tavily-tools.ts

skills/                     # skills
  alignment/
  design-pi-capability/
  github-workflow/

prompts/                    # prompt templates

packages/                   # 开发用 submodules
  pi-prompt-intercept/

scripts/                    # 本地开发 setup/teardown
README.md                   # 能力、安装和配置说明
```
