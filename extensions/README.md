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
- RTK setup：手动重跑 `rtk init -g --agent pi`。`npm run setup` 会默认尝试执行一次。
- Tavily status：显示 Tavily key pool 状态。

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
```

设计边界：这是本地 router command，不通过模型 request 做配置和查看。

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
- `remote_exec`
- `remote_exec_batch`
- `remote_probe_devices`
- `remote_test_connection`
- `remote_add_device`
- `remote_learn_alias`
- `remote_install_keys`

运行时设备配置默认写入 `~/.pi/agent/remote-devices/devices.json`，首次加载会从 extension 内的 `devices.json` seed 初始化。`remote_probe_devices` 的 Rust helper 会从源码按本机平台编译到同一用户状态目录，不随 oh-my-pi 携带外来预编译二进制。

## model-relay.ts

`model-relay.ts` 提供本地命令：

```txt
/model-relay-add
```

也可以从 `/oh-my-pi` 选择 `Model relays` 进入。

它用于交互式添加或更新 pi 模型中转站/provider，目标文件是 `~/.pi/agent/models.json`。

设计边界：这是自有 extension command，而不是 skill。它和 `/model` 类似，是本地结构化配置操作；运行时不需要向模型发送 request，也不需要联网。命令只收集输入、生成 JSON、让用户确认，然后写入本机配置。

## tavily-tools.ts

`tavily-tools.ts` 注册两个模型可调用工具：

- `tavily_search`
- `tavily_extract`

它会在 `session_start` 时自动启用这两个 tools，并提供命令：

```txt
/tavily-pool-status
```

## API key 来源

按优先级读取：

- `TAVILY_API_KEYS`
- `TAVILY_API_KEY`
- `TAVILY_KEYCHAIN_SERVICES`
- macOS Keychain 默认服务名：`pi-tool-api-key-tavily`、`pi-tool-api-key-tavily-2` ...

## 并发和冷却参数

可通过环境变量调整：

- `TAVILY_POOL_MAX_CONCURRENCY`
- `TAVILY_POOL_PER_KEY_CONCURRENCY`
- `TAVILY_POOL_COOLDOWN_MS`
- `TAVILY_KEYCHAIN_AUTO_DISCOVER_LIMIT`

## 设计边界

这是自有 extension，因为它注册了确定性 tools 并处理 key pool、并发、错误分类和返回格式。它不应该被写成 skill：联网搜索/抽取是程序能力，不是模型判断流程。
