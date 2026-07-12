# Subagent

`subagent` 提供 bounded、isolated 的通用任务委派。

Capability profiles：

- `read-only`：自动授权；scoped `read`、`grep`、`find`、`ls`。
- `workspace-write`：交互确认；自动创建独立 git worktree，在其中提供 scoped 文件 tools 和 OS-sandboxed `bash`。
- `elevated`：交互确认，同样使用独立 workspace，并要求显式 one-dispatch overrides：`network`、`repo-outside`、`package-install`、`git-mutation`。

Runtime enforcement：

- 文件 tools canonicalize absolute path、`..`、symlink 和新文件 ancestor，并执行 include/exclude scope。
- `bash` 使用 `@anthropic-ai/sandbox-runtime`：macOS 通过 `sandbox-exec`，Linux 通过 bubblewrap。
- workspace 外写入和默认 network 被 OS sandbox 阻止。
- privilege escalation、package install 和 git mutation 还会经过 command preflight；相关 override 仅对当前 dispatch 生效。
- non-TUI 模式不允许启动需要确认的 profiles。

Coding isolation/handoff：

- git repo 使用 `~/.pi/agent/subagents/worktrees/` 下的 ephemeral branch + worktree；parent worktree 不会被 child 修改。
- 非 git 目录复制到同一 runtime state root，绝不直接修改 source directory。
- handoff 返回 git status、changed/untracked/binary paths、patch artifact、workspace/branch 和 recovery/cleanup 信息。
- 有改动的 workspace 默认保留为 `handoff-ready`，避免删除唯一改动；无改动的 workspace 自动清理。
- 不自动 commit、push、merge、cherry-pick 或应用 patch。

通用边界：

- child 使用独立 in-memory `AgentSession`。
- 不复制 parent conversation，不默认加载 parent extensions、skills 或 prompts。
- 支持 `small`、`standard`、`large` budgets；`large` 需要交互确认。
- 支持 parent cancel、budget abort 和 session shutdown cleanup。
- 中间事件只进入 tool renderer/details；parent model只接收最终结构化结果。
- 不支持 remote tools、递归 subagent 或 pause/resume。

Linux 运行 sandboxed `bash` 需要系统安装 `bubblewrap`、`socat` 和 `ripgrep`；缺失或初始化失败时 fail closed。
