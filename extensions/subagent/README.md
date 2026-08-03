# Subagent

`subagent` 提供 bounded、isolated 的通用任务委派。

当前 capability 默认关闭，extension 不注册 `subagent` 或 `subagent_batch`。仅在显式设置 `OH_MY_PI_SUBAGENT_ENABLED=1` 后启用；修改环境后需要重启 pi 或执行 `/reload`。

Capability profiles：

- `read-only`：自动授权；scoped `read`、`grep`、`find`、`ls` 和 OS-sandboxed `bash`。bash 禁止 workspace 写入和 network。
- `workspace-write`：无需交互确认。自动创建独立 git worktree 或 directory copy，在隔离 workspace 中提供 scoped 文件 tools 和 OS-sandboxed `bash`。
- `elevated`：每个 dispatch 都交互确认，同样使用独立 workspace，并要求显式 one-dispatch overrides：`network`、`repo-outside`、`package-install`、`git-mutation`。

Runtime enforcement：

- 文件 tools canonicalize absolute path、`..`、symlink 和新文件 ancestor，并执行 include/exclude scope。
- `bash` 使用 `@anthropic-ai/sandbox-runtime`：macOS 通过 `sandbox-exec`，Linux 通过 bubblewrap。
- workspace 外写入和默认 network 被 OS sandbox 阻止。
- privilege escalation、package install 和 git mutation 还会经过 command preflight；相关 override 仅对当前 dispatch 生效。
- non-TUI 模式允许 `read-only` 和 `workspace-write`；需要越过默认隔离边界的 `elevated` 仍要求交互确认。

Coding isolation/handoff：

- git repo 使用 `~/.pi/agent/subagents/worktrees/` 下的 ephemeral branch + worktree；parent worktree 不会被 child 修改。
- 如果 cwd 是上层 git repo 中完全未被 `HEAD` 跟踪的子目录，则改用 directory-copy isolation，避免被上层 repo 的无关 dirty 状态阻塞。
- single 和 batch 写任务会在创建 child 前预检 isolation。tracked Git workspace 非干净时返回 `needs-context` / `preflight-blocked` 和安全处理选项；batch 不启动任何 node，且不能通过确认绕过。
- 真正创建 isolation 时仍再次校验 source 状态，避免 preflight 后工作树变化绕过 fail-closed 边界。
- 非 git 目录复制到同一 runtime state root，绝不直接修改 source directory。
- handoff 返回 git status、changed/untracked/binary paths、patch artifact、workspace/branch 和 recovery/cleanup 信息。
- 有改动的 workspace 默认保留为 `handoff-ready`，避免删除唯一改动；无改动的 workspace 自动清理。
- 不自动 commit、push、merge、cherry-pick 或应用 patch。

Bounded DAG scheduler：

- `subagent_batch` 接收 parent 明确给出的完整 DAG；scheduler 不调用 model 分解任务，也不会运行时新增 node 或自动开启下一批。
- `subagent_batch` 只适合已经拆好的小型独立工作单元。需要逐步吸收证据、调整范围或分析大 repo/corpus/book 时，parent 应重复调用单个 `subagent`，每轮整合 structured result 后再派下一段。
- 最多 8 nodes、并发 3、深度 3；调用方只提供 node id，创建 batch 时自动注入 task id；校验 duplicate id、missing dependency 和 cycle。
- dependency 只有 `completed` 才解锁下游；失败会把下游标记为 `blocked`。
- unordered coding nodes 的 path scopes 重叠时拒绝 dispatch；有 dependency 顺序时允许 sequential。
- node budget 之外还有 batch budget；batch cancel/超限会 abort active children 并阻止 pending nodes。child 不响应 abort 时，scheduler 会在 grace deadline 后合成终态，保证 aggregate result 返回。
- aggregate result 保留每个 node 的 structured result、evidence、usage 和 blocked reason，model-visible output 超过 50KB 时自动裁剪。

通用边界：

- child 使用独立持久 `AgentSession`，JSONL sidechain 位于 `~/.pi/agent/subagents/sessions/<parent-session-id>/`，不会注入 parent conversation。
- child 的 transient provider error 最多自动重试 2 次。
- terminal result 返回 bounded structured result；失败额外返回最后 assistant 文本、近期事件、stop reason 和 transcript path，parent 可恢复证据而不必从零调查。
- 不复制 parent conversation，不默认加载 parent extensions、skills 或 prompts。
- 支持 `small`、`standard`、`large` budgets；单个 dispatch 默认 `small`。预算同时限制 turns、tool calls、wall time、单次 tool result 和累计 tool output，避免通过连续大块读取撑爆 child context。`elevated` dispatch 的确认对其完整预算一次生效。
- provider 阶段有 inactivity watchdog：仅在等待或接收模型流时计时，stream activity 会刷新期限，tool 执行期间暂停；超时返回带 recovery 和 transcript path 的 `runtime-error`。
- 支持 parent cancel、budget abort 和 session shutdown cleanup。
- 中间事件只进入 tool renderer/details；parent model只接收最多 50KB 的最终结构化结果。
- 不支持 remote tools、递归 subagent、后台运行或原地 pause/resume。持久 transcript 和 retained worktree 是当前恢复边界。

Linux 运行 sandboxed `bash` 需要系统安装 `bubblewrap`、`socat` 和 `ripgrep`；缺失或初始化失败时 fail closed。
