# Extensions

这个目录放 oh-my-pi 自己维护、默认加载的 pi extensions。

## pi-proxy (standalone)

Proxy recovery is supplied by the `pi-proxy` dependency and its own `pi.extensions` metadata. The local `proxy/` extension and tests are retired; `proxy_status`, `proxy_diagnose`, `proxy_enable`, and `proxy_disable` are not compatibility aliases.

New tools: `proxy_runtime_status`, `proxy_runtime_diagnose`, and `proxy_runtime_recover`. Recovery requires UI confirmation, screens selector candidates, verifies GitHub HTTPS through the selected proxy, and retains process-local child environment plus Agent-owned fallback resources until session shutdown. Headless recovery is denied; diagnostics remain usable. No default proxy port or automatic replay of a failed caller operation.

Configuration and restricted macOS fallback YAML: `node_modules/pi-proxy/README.md`. The package is registered via its own metadata and the root installer merge; `package-lock.json` pins the installed standalone commit.

## append-system/

`append-system` 为 Pi 原生 `APPEND_SYSTEM.md` 提供 package fallback。Pi 已加载受信任项目的 `.pi/APPEND_SYSTEM.md`、用户配置目录中的 `APPEND_SYSTEM.md`，或 CLI `--append-system-prompt` 时，extension 不追加任何副本；没有 native append 时，才把 `system/APPEND_SYSTEM.md` 追加到当前 chained system prompt。

`append-system` 会报告 `local/native configured`、`bundled fallback active` 或 `bundled fallback disabled`。本地 prompt 在 Pi 启动或 `/reload` 时加载，运行中修改后应执行 `/reload`。

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

`phase-trace.ts` 在输入框上方提供唯一一行 realtime status：

```txt
✽ Running bash · npm test · 2s · total 18s
[input]
```

支持命令：

```txt
/work-trace
```

主状态行只显示 `Waiting`、`Analyzing`、`Responding`、`Running`、`Retrying`、`Compacting`、`Summarizing` 和 `Cancelling` 等 runtime stage，不显示 workflow phase。phase、阶段耗时、bounded 摘要和 subagent 详情通过 `/work-trace` 查看。活动动画固定为 `✻ → ✽ → ✳ → ✽`，80ms/frame；idle/terminal 后 widget 与 timer 都停止。普通状态严格一行，retry 最多两行，左右各保留一格并按终端宽度截断。

Pi 原生 working/retry/compaction row 和 reasoning/`Thinking...` 正文在 phase trace 启用时隐藏，避免重复状态和空行。Tool 从 `tool_execution_start` 起计入 Running；并行 tool 全部结束后才回到 Waiting，tool failure 只计入诊断，不直接终结 phase。retry 使用 10 次上限和 1s、2s、2s、5s、9s、20s、38s、38s、38s、40s schedule；`Retry-After` 从 provider response header 读取并优先用于 runtime status，不从 error 文本推断 provider 意图。

终态只在 `agent_settled` 后生成，避免 retry、compaction 或 queued continuation 中间过早写入 Summary。稳定终态为 `Done`、`Failed`、`Cancelled`、`Interrupted`。`/work-trace` 展示当前或最近 turn 的互斥 waiting/analyzing/executing/retrying/responding/compacting/summarizing 累计、tool 状态统计、retry 来源、phase 以及 subagent 实际 model。

设置 `OH_MY_PI_PHASE_TRACE_DISABLED=1` 可恢复原 compact tool transcript、task timer footer 和 working row。未使用 subagent 的阶段显示 `main`；single/batch subagent 会按 dispatch phase 归组。Subagent capability 的全局开关由 `~/.pi/agent/subagent/config.json` 的 `enabled` 字段控制。

每个可审计 tool 以独立的 Tools UI-only entry 按调用顺序显示，避免多个 tool 被压成一条记录。Tools 保存 typed args、partial updates、typed result 和 completed/failed/cancelled 统计；Pi 原生全局 `Ctrl+O` 直接把 `expanded` 传给 entry renderer，展开后显示完整参数、Markdown、diff、图片 fallback 和既有截断 metadata。Result 与 Partial 使用不同弱背景，Summary 透明；无字符 border、无 extension shortcut proxy。

这些 entries 不进入 `buildSessionContext()`；原始 assistant/tool messages 仍保留 session/model 语义，但 compatibility patch 在 phase trace 启用时抑制它们的重复 transcript。安装或检查 patch：

```txt
npm run pi-transcript-surfaces -- status
npm run pi-transcript-surfaces -- apply
npm run pi-transcript-surfaces -- restore
```

patch 对 assistant、tool 和 bundled renderer 使用唯一 source markers、atomic write、backup 与 checksum 校验；marker 不匹配时 fail closed。设置 `OH_MY_PI_PHASE_TRACE_DISABLED=1` 恢复原生 assistant/tool transcript。


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

`status-bar.ts` 提供 oh-my-pi 自有固定两行环境 footer。第一行显示 model、thinking level、压缩后的真实 cwd、Git branch，以及 Context 百分比和 `current/contextWindow` 绝对用量；第二行显示 Subagents capability、配置或实际 model、active count、input/output token 与 cache hit rate。Footer 无封闭边框，40/80/120 列按 branch、thinking、cache detail 的顺序降级，同时保留 model、Context 绝对用量、Subagents 状态/model 和核心 token 数据。Git branch、model、Context/token 与 subagent lifecycle 更新都会触发重绘。

```txt
/status-bar
/status-bar on
/status-bar off
/status-bar toggle
```

它通过 `ctx.ui.setFooter(...)` 接管 footer，并保持左右各一格 padding。宽屏显示完整 environment 与资源信息；中窄屏采用有语义的 compact labels，不通过尾部截断丢失 Context current/limit、Subagents model 或 input/output totals。

执行阶段、tool、错误和计时由输入框上方的 phase/realtime status 承载，不占用 footer 的 `STEP`、`DETAIL` 或 timer 行。`/status-bar` 保留完整诊断信息。



## mineru/

`mineru` extension 提供云端文档解析的配置与授权入口：

```txt
/mineru setup
/mineru status
/mineru revoke
```

Token 优先读取 `MINERU_TOKEN`，fallback 到 macOS Keychain service `pi-tool-api-key-mineru`。`~/.pi/agent/mineru/config.json` 只保存非敏感 cloud upload authorization marker，不保存 token。配置流程披露文件会发送到 `mineru.net`、服务端可能保留最多 30 天，以及本地取消不保证远端任务停止。

`mineru` extension 已移出本目录，由独立 package 提供配置和授权入口。

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
