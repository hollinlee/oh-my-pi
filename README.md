# oh-my-pi

个人 pi 配置 package。它把常用的 pi extensions、skills、prompt templates 和外部集成整理成一个可安装的 package。调试类能力可以默认加载，但默认不打开 UI、不阻塞请求。

## 能力

### 本地控制台

`/oh-my-pi` 提供一个本地能力控制台，用来查看和进入常用配置入口：

- Tools：查看并启用/禁用当前 tools，状态随 session branch 恢复。
- Commands：查看当前 extension command、prompt template 和 skill command。
- Skills：查看 skill commands。
- Extensions：按来源 path 查看 extension 暴露的 commands。
- Model relays：进入模型中转站/provider 配置向导。
- RTK setup：手动重跑 `rtk init -g --agent pi`。
- Tavily status：查看 Tavily key pool 状态。

也支持少量参数直达：

```txt
/oh-my-pi tools
/oh-my-pi commands
/oh-my-pi skills
/oh-my-pi extensions
/oh-my-pi relays
/oh-my-pi rtk
/oh-my-pi tavily
```

### 模型中转站/providers

`/model-relay-add` 提供交互式向导，用来生成或更新 `~/.pi/agent/models.json`。

支持把 API key 配置为：

- 省略，使用 `/login`、`auth.json` 或启动参数。
- 直接写入 `models.json`。
- 从环境变量读取。
- 从 macOS Keychain 读取。

### Tavily tools

`extensions/tavily-tools.ts` 注册模型可调用 tools：

- `tavily_search`
- `tavily_extract`

并提供命令：

```txt
/tavily-pool-status
```

它支持多个 Tavily API keys、Keychain 自动发现、并发限制和 cooldown。

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
- `.pi/`：项目本地运行状态和调试输出。
- 第三方 extensions：优先从对方的 git/npm source 安装；只有决定由本 repo 维护时才放进 `extensions/`。

## 目录结构

```txt
extensions/                 # 默认加载的稳定 extensions
  oh-my-pi.ts
  model-relay.ts
  tavily-tools.ts

skills/                     # skills
  design-pi-capability/

prompts/                    # prompt templates

packages/                   # 开发用 submodules
  pi-prompt-intercept/

scripts/                    # 本地开发 setup/teardown
README.md                   # 能力、安装和配置说明
```
