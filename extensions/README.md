# Extensions

这个目录放 oh-my-pi 自己维护、默认加载的 pi extensions。

## hookify/

规则每次 tool call 重新读取，修改文件后下一次调用立即生效。为避免无界读取，最多接受 32 个 `.md` 文件、每个文件 64 KiB；超出上限时诊断被忽略的文件并 fail closed 阻止 `bash`，不会静默放过不确定的规则集合。

规则使用简单 frontmatter：

```md
---
name: block-dangerous-rm
event: bash
pattern: rm\s+-rf
action: block
priority: 100
message: 不允许删除文件系统内容
---
```

支持的 action 只有 `warn`、`confirm`、`block`；没有可以绕过其他安全策略的 `allow`。匹配规则按 `block > confirm > warn`，同 action 再按 `priority` 降序、name 和文件名稳定排序。`confirm` 只在 TUI 中请求确认，non-TUI 直接 fail closed；`warn` 不修改命令。无效规则逐文件忽略并输出诊断。

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
/oh-my-pi rtk
/oh-my-pi tavily
/oh-my-pi task-timer
```

设计边界：这是本地 router command，不通过模型 request 做配置和查看。

## append-system/

`append-system` 为 Pi 原生 `APPEND_SYSTEM.md` 提供 package fallback。Pi 已加载受信任项目的 `.pi/APPEND_SYSTEM.md`、用户配置目录中的 `APPEND_SYSTEM.md`，或 CLI `--append-system-prompt` 时，extension 不追加任何副本；没有 native append 时，才把 `system/APPEND_SYSTEM.md` 追加到当前 chained system prompt。

该能力不会创建、覆盖或同步用户配置文件。`OH_MY_PI_APPEND_SYSTEM_DISABLED=1` 会禁用 bundled fallback。`/oh-my-pi doctor` 显示当前使用 `local/native configured`、`bundled fallback active` 或 `bundled fallback disabled`。本地 prompt 在 Pi 启动或 `/reload` 时加载，运行中修改后应执行 `/reload`。

## usage/

`usage` 提供 local-only 的全屏 usage dashboard 和安全生命周期操作：

```txt
/usage
/usage purge
```

Dashboard 支持 `1` Today、`2` 7 days、`3` 30 days，`Tab` 在 Models/Providers/Projects breakdown 间切换，`r` 重新扫描，`p` 清除 usage 数据，`Esc` 关闭。`Total` 等于 input + output + cache read + cache write tokens；`Cost` 直接累计 session/intake 已记录的 `usage.cost.total`，不按当前 model prices 重算历史。Responses 只计算 assistant responses。

状态默认写入 `~/.pi/agent/usage/`，也可用 `OH_MY_PI_USAGE_STATE_DIR` 覆盖。SQLite ledger 和 intake journal 仅存 accounting metadata：timestamp、operation、provider、model、project path、token/cost/response counters，以及 hashed event/source identities。它们不会保存 prompt、assistant content、thinking、summary、tool arguments/output 或任何 session 正文，也不会上传数据。

Ledger retention 独立于 Pi session retention：session file 删除后，已采集的历史仍留在 ledger，避免统计随 session housekeeping 消失。`/usage purge` 与 dashboard `p` 使用同一个安全实现并要求二次确认；它们只 unlink 固定的 `usage.sqlite3`、`usage.sqlite3-wal`、`usage.sqlite3-shm` 和 `intake/usage-event-v1.jsonl`，然后重建空 schema，不递归删除 state directory，也绝不删除或修改 Pi session files。Purge 后 refresh 会重新采集仍存在的 sessions；已删除 source session 的历史无法恢复。

`/oh-my-pi doctor` 检查 `/usage` 注册、ledger schema、state/DB/intake 私有权限和可写性。未初始化时只报告 info，不创建 ledger。

## image-result-limiter.ts

`image-result-limiter.ts` 在 built-in `read` 返回图片后、写入 model context/session 前压缩大 payload。默认只处理超过 350KB 的图片，最长边限制为 1280，使用 Photon 重编码为有界 JPEG；无法安全解码的大图会被省略并返回明确文本，而不是把任意 base64 写入 JSONL。可用 `OH_MY_PI_IMAGE_MAX_BYTES`、`OH_MY_PI_IMAGE_MAX_EDGE` 调整，或用 `OH_MY_PI_IMAGE_LIMIT_DISABLED=1` 禁用。

## work-issue-autopilot.ts

`work-issue-autopilot.ts` 为显式 `/work-issue` 队列维护 branch-aware session state。`work_issue_checkpoint` 记录 progress、已完成 issue、human gate 和队列完成；agent 在队列仍 active 时普通停止，`agent_settled` 会注入 bounded follow-up。Provider error、abort、human gate 和连续 8 次无 progress 不会继续硬冲。`/autopilot-status` 查看状态，`/autopilot-stop` 显式停止 guard。

## subagent/

`subagent` 是 oh-my-pi 自己的 pi-local capability。配置文件为 `~/.pi/agent/subagent/config.json`；缺失时默认关闭。设置 `enabled: true` 启用，设置 `defaultModel` 可固定所有 direct child model；修改后需重启 pi 或执行 `/reload`。

它负责 bounded、isolated 的单机任务委派：child 使用独立 `AgentSession`、本地 sandbox、独立 worktree 或 directory copy，并返回结构化结果。

`subagent_batch` 是本地 deterministic bounded DAG scheduler，不负责跨 workspace 的持久 orchestration。实现和完整约束见 `extensions/subagent/README.md`。

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

启用 phase trace 时，项目自有 tool renderer 不再把 call/result 写入 transcript；tool result 仍完整保存在 session/context，执行摘要和 error 转入阶段轨迹。设置 `OH_MY_PI_PHASE_TRACE_DISABLED=1` 后恢复 compact transcript：collapsed 状态显示 tool target、完成状态和 line/diff count，原生 expansion 可查看完整 output。

可通过 `OH_MY_PI_COMPACT_TOOLS_DISABLED=1` 禁用 built-in renderer override；该设置不改变 phase trace 对执行反馈的所有权。

## phase-trace.ts

`phase-trace.ts` 在输入框上方提供当前 turn 的 milestone 阶段和单行 realtime status：

```txt
○ Implement
⠼ Running bash · npm test
[input]
```

支持命令：

```txt
/work-trace status
/work-trace expand
/work-trace collapse
/work-trace toggle
```

当前 phase 使用 `Inspect`、`Plan`、`Implement`、`Verify`、`Review`、`Diagnose` 等 canonical 名称；未知名称使用可见的 `Working` fallback，并显示已耗时。阶段符号为 `○`、`✓`、`×`、`–`，其中 `–` 表示 cancelled 状态。realtime status 使用循环 Braille spinner，tool 只显示单行短摘要并在窄终端截断。Pi 原生 multi-line `Thinking` indicator 会被隐藏，避免重复文本和空行。

默认收起显示当前阶段、已耗时和 realtime status；`Ctrl+O` 可展开或收起历史 trace，当前状态行位置保持不变。即使模型尚未发布 canonical phase，也会显示带计时的 `Working` fallback，避免阶段区为空。环境 footer 仍位于输入框下方。对于可见的 canonical 阶段，错误会结束阶段并显示失败符号，agent 正常结束时显示完成符号；新用户输入会清除上一轮结果。

设置 `OH_MY_PI_PHASE_TRACE_DISABLED=1` 可恢复原 compact tool transcript、task timer footer、working row 和 workflow card。未使用 subagent 的阶段显示 `main`；single/batch subagent 会按 dispatch phase 归组。展开后显示阶段摘要、task ID、实际 model、状态和耗时。Subagent capability 的全局开关由 `~/.pi/agent/subagent/config.json` 的 `enabled` 字段控制。

## user-prompt.ts

`user-prompt.ts` 为当前编辑器输入添加视觉 `❯` 前缀，不修改实际输入内容。历史用户消息的视觉 prompt 和高亮块外层 padding 由以下命令管理：

```txt
npm run pi-user-prompt -- status
npm run pi-user-prompt -- apply
npm run pi-user-prompt -- restore
```

该 patch 保留历史输入高亮，只移除 renderer 生成的外层空白；用户原文开头、结尾和内部空行保持不变。多行输入只在第一行显示 `❯`，assistant/tool 内容不显示该前缀。Pi 版本或 renderer source markers 不匹配时会 fail closed。

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

`status-bar.ts` 提供 oh-my-pi 自有固定两行环境 footer，以及 phase trace 禁用时的兼容 workflow card：

```txt
/status-bar
/status-bar on
/status-bar off
/status-bar toggle
/workflow-card demo
/workflow-card success PR created | #41 | ttl 10s
/workflow-card clear
```

它通过 `ctx.ui.setFooter(...)` 接管 footer。第一行显示 model、thinking level、压缩后的真实 cwd、Git branch 和 context 进度条；第二行显示 Subagents capability ON/OFF、input/output token 与 cache hit rate。Footer 使用暖橙单一强调色、弱灰辅助信息和无封闭边框布局。40/80/120 列会按 branch、thinking、cache detail 的顺序降级，同时保持 model、context、cwd、subagent 开关和核心 token 数据可见。Git branch 通过 `footerData.onBranchChange(...)` 触发重绘。

执行阶段、tool、错误和计时由输入框上方的 phase/realtime status 承载，不再占用 footer 的 `STEP`、`DETAIL` 或 timer 行。`/status-bar` 仍保留完整诊断信息。设置 `OH_MY_PI_PHASE_TRACE_DISABLED=1` 后，workflow card 恢复为独立的 UI-only widget。

Workflow milestone cards 通过 `oh-my-pi:card` event 显式触发，payload 支持 `kind: "success" | "info" | "warning" | "error"`、`title`、`detail?`、`meta?`、`ttlMs?`。card 使用 `ctx.ui.setWidget(...)` 渲染为 UI-only surface，不写入 transcript，不触发 LLM turn；新 card 会替换旧 card，TTL 到期后自动清除。

## mineru/

`mineru` extension 提供云端文档解析的配置与授权入口：

```txt
/mineru setup
/mineru status
/mineru revoke
```

Token 优先读取 `MINERU_TOKEN`，fallback 到 macOS Keychain service `pi-tool-api-key-mineru`。`~/.pi/agent/mineru/config.json` 只保存非敏感 cloud upload authorization marker，不保存 token。配置流程披露文件会发送到 `mineru.net`、服务端可能保留最多 30 天，以及本地取消不保证远端任务停止。

`/oh-my-pi mineru` 进入同一入口，doctor 检查 command、token source、authorization marker 和 runtime config boundary。`OH_MY_PI_MINERU_DISABLED=1` 可紧急禁用 capability。

该 extension 注册 `mineru_parse`：只接受用户明确指定的单个本地文档，使用 Precision API 的 presigned upload flow，安全下载并只 materialize `full.md`。Tool result 返回 bounded preview、job/batch ID 和本地 result path；不支持 URL、HTML、目录、batch 或 flash API。Timeout/cancel 后保存最小 manifest并返回 `remoteMayContinue`；传入 `job_id` 可恢复既有 polling/download，不重复上传。幂等临时失败最多重试 3 次，jobs/results 默认 24 小时 TTL。

`skills/mineru-document-parsing/SKILL.md` 负责 model/OCR/language routing、明确文件上传边界、result path 有界检索以及 VLM/XLSX 风险提示。Doctor 同时检查 `mineru_parse` tool、skill package 和 skill command registration。

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
