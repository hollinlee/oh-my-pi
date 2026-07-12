# Extensions

这个目录放 oh-my-pi 自己维护、默认加载的 pi extensions。

## oh-my-pi.ts

`oh-my-pi.ts` 提供本地能力控制台：

```txt
/oh-my-pi
```

第一版包含：

- Tools：查看并启用/禁用当前 tools，状态随 session branch 恢复。
- Commands：查看当前 extension command、prompt template 和 skill command。
- Skills：只查看 skill commands。
- Extensions：按 extension command 的来源 path 查看已暴露命令的 extensions。
- Remote devices：查看 remote-devices command/tools 是否已加载。
- Model relays：进入模型中转站/provider 添加流程。
- RTK setup：查看 RTK 状态、手动重跑 `rtk init -g --agent pi`，并管理 bash rewrite suggestion mode。`npm run setup` 会默认尝试执行一次。
- Tavily status：显示 Tavily key pool 状态。
- Status bar：查看 oh-my-pi 状态栏和 tool activity summary。
- Task timer：查看本轮任务耗时和当前阶段。

也支持少量参数直达：

```txt
/oh-my-pi tools
/oh-my-pi commands
/oh-my-pi skills
/oh-my-pi extensions
/oh-my-pi remote
/oh-my-pi relays
/oh-my-pi rtk
/oh-my-pi tavily
/oh-my-pi task-timer
```

设计边界：这是本地 router command，不通过模型 request 做配置和查看。

## subagent/

`subagent` 提供 bounded、isolated 的通用任务委派。child 使用独立 in-memory `AgentSession`，只接收结构化 task packet；支持自动授权的 `read-only`、需确认的 `workspace-write`，以及带 one-dispatch overrides 的 `elevated` profile。

文件 tools 对 absolute path、`..`、symlink 和新文件 ancestor 执行 canonical scope enforcement。写 profile 的 `bash` 使用 `@anthropic-ai/sandbox-runtime` 做 OS-level filesystem/network isolation，并额外阻止未授权的权限提升、package install 和 git mutation。macOS 使用 `sandbox-exec`；Linux 需要 bubblewrap、socat 和 ripgrep。sandbox 不可用时 fail closed。

它还支持 `small`、`standard`、`large` budget、parent cancel、budget abort、session shutdown cleanup，以及 compact/expanded tool renderer。中间 transcript 不进入 parent model context；parent 只接收最终结构化结果。当前不支持 remote tools、递归 subagent 或 pause/resume。

## remote-devices/

`remote-devices` 提供本地远程设备管理能力：

```txt
/remote-devices list
/remote-devices probe
/remote-devices test <device>
```

并注册模型可调用工具：

- `remote_list_devices`
- `remote_resolve_device`
- `remote_write`
- `remote_exec`
- `remote_exec_batch`
- `remote_probe_devices`
- `remote_test_connection`
- `remote_add_device`
- `remote_learn_alias`
- `remote_install_keys`

文本写入远程文件用 `remote_write`，执行远程命令用 `remote_exec`。`remote_write` 的 `content` 作为数据传输，不因为文本里出现 `reboot`、`shutdown`、`rm -rf /` 等词触发命令级 dangerous scanner；敏感路径写入仍需要明确 `allowDangerous=true`。

运行时设备配置默认写入 `~/.pi/agent/remote-devices/devices.json`，首次加载会从 extension 内的 `devices.json` seed 初始化。`remote_probe_devices` 的 Rust helper 会从源码按本机平台编译到同一用户状态目录，不随 oh-my-pi 携带外来预编译二进制。

## model-relay.ts

`model-relay.ts` 提供本地命令：

```txt
/model-relay-add
```

也可以从 `/oh-my-pi` 选择 `Model relays` 进入。

它用于交互式添加或更新 pi 模型中转站/provider，目标文件是 `~/.pi/agent/models.json`。

设计边界：这是自有 extension command，而不是 skill。它和 `/model` 类似，是本地结构化配置操作；运行时不需要向模型发送 request，也不需要联网。命令只收集输入、生成 JSON、让用户确认，然后写入本机配置。

## rtk-adapter.ts

`rtk-adapter.ts` 提供低侵入 RTK adapter：

```txt
/rtk-adapter
/rtk-adapter setup
/rtk-adapter suggestions on
/rtk-adapter suggestions off
/rtk-adapter suggestions toggle
```

它检查 `rtk` 是否可用，保留手动 `rtk init -g --agent pi` setup，并在 suggestion mode 中通过 `rtk rewrite` 提示可替代 bash 命令。它不默认改写实际 `bash` tool call；RTK 不存在或 rewrite 失败时 fail-open，不影响原始命令执行。

可通过 `OH_MY_PI_RTK_SUGGESTIONS_DISABLED=1` 默认关闭 suggestion mode。

## compact-tool-renderer.ts

`compact-tool-renderer.ts` 在 TUI session 中默认折叠 tool output，并为当前启用的 built-in tools 提供 compact renderer：

```txt
/compact-tools
/compact-tools collapse
/compact-tools expand
/compact-tools toggle
```

Collapsed 状态只显示 tool target、完成状态和 line/diff count；使用 Pi 原生 tool expansion 操作可查看完整原始 output。Error、timeout 和 dangerous-blocked 即使在 collapsed 状态下也显示 capped error detail，不会为了单个错误全局展开历史 tools。Remote 和 Tavily tools 使用同一 collapsed/expanded 语义。

可通过 `OH_MY_PI_COMPACT_TOOLS_DISABLED=1` 禁用 built-in renderer override 和默认折叠行为。

## task-timer.ts

`task-timer.ts` 提供本轮任务耗时和阶段状态：

```txt
/task-timer
/task-timer on
/task-timer off
/task-timer toggle
```

它把 timer 状态发布给 oh-my-pi footer；collapsed footer 只把 elapsed 追加到 `STEP`，完整 stage 保留在 `/task-timer` 和 `/status-bar` 诊断中，不再独立占用 `TIMER` 槽位或 `ctx.ui.setStatus(...)`。当前阶段会在等待 provider、thinking、answering、tool 执行和等待用户时切换；tool 执行阶段优先显示。agent 结束后计时暂停并显示等待用户。

可通过 `OH_MY_PI_TASK_TIMER_DISABLED=1` 默认关闭。

## status-bar.ts

`status-bar.ts` 提供 oh-my-pi 自有固定 3 行 footer、聚合 detail lane 和 UI-only workflow milestone cards：

```txt
/status-bar
/status-bar on
/status-bar off
/status-bar toggle
/workflow-card demo
/workflow-card success PR created | #41 | ttl 10s
/workflow-card clear
```

它通过 `ctx.ui.setFooter(...)` 接管 footer，collapsed 状态固定显示 3 行：前两行是自然左对齐的 `MODEL / CWD`、`CTX / STEP`，第二项紧跟第一项内容而不是固定从屏幕中点开始；第三行是 full-width `DETAIL`。Task timer 只把 elapsed 追加到 `STEP`，不再重复 stage；tool summary、detail `summary` 和 `info` 聚合到第三行。所有 tool 都有通用参数、stream update 和 result fallback，不需要各 extension 单独接入；显式调用 skill/prompt slash command 时还会显示 command source、description 和参数。读取 `skills/<name>/SKILL.md` 时会标记对应 skill。新 turn 会清除旧 detail，避免 remote 或其他 producer 的残留信息遮住当前动作。`MODEL` 优先显示 model name；`TOKENS`、latest tool 和完整 timer stage 保留在 `/status-bar` 诊断详情中。Remote expanded 时 footer 会临时增加有限 detail 行，只显示 focused remote card 的 tail/detail。Footer 不存储或吞掉原始 tool output；transcript 折叠由 `compact-tool-renderer.ts` 独立负责。`STEP` 可通过 `oh-my-pi:step` event 显式设置短状态并在 TTL 后回落自动推断。

Workflow milestone cards 通过 `oh-my-pi:card` event 显式触发，payload 支持 `kind: "success" | "info" | "warning" | "error"`、`title`、`detail?`、`meta?`、`ttlMs?`。card 使用 `ctx.ui.setWidget(...)` 渲染为 UI-only surface，不写入 transcript，不触发 LLM turn；新 card 会替换旧 card，TTL 到期后自动清除。

## tavily-tools.ts

`tavily-tools.ts` 注册四个模型可调用工具:

- `tavily_search`
- `tavily_extract`
- `tavily_crawl`
- `tavily_research`

它会在 `session_start` 时自动启用这些 tools，并提供命令：

```txt
/tavily-pool-status
```

## API key 来源

按优先级读取：

- `TAVILY_API_KEYS`
- `TAVILY_API_KEY`
- `TAVILY_KEYCHAIN_SERVICES`
- macOS Keychain 默认服务名：`pi-tool-api-key-tavily`、`pi-tool-api-key-tavily-2` ...

`tavily_crawl` 只接受公共 `http(s)` URL，并限制 crawl depth、页数、path pattern 数量和返回字符数。`tavily_research` 会创建 Tavily research task 并在有限时间内轮询完成结果；它适合有边界的公开 web research，不替代模型自己的判断。

## 并发和冷却参数

可通过环境变量调整：

- `TAVILY_POOL_MAX_CONCURRENCY`
- `TAVILY_POOL_PER_KEY_CONCURRENCY`
- `TAVILY_POOL_COOLDOWN_MS`
- `TAVILY_KEYCHAIN_AUTO_DISCOVER_LIMIT`

## 设计边界

这是自有 extension，因为它注册了确定性 tools 并处理 key pool、并发、错误分类和返回格式。它不应该被写成 skill：联网搜索/抽取是程序能力，不是模型判断流程。
