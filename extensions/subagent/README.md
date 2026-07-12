# Subagent

`subagent` 提供 bounded、isolated 的通用任务委派。

Capability profiles：

- `read-only`：自动授权；scoped `read`、`grep`、`find`、`ls`。
- `workspace-write`：交互确认；scoped 文件 tools 和 OS-sandboxed `bash`。
- `elevated`：交互确认，并要求显式 one-dispatch overrides：`network`、`repo-outside`、`package-install`、`git-mutation`。

Runtime enforcement：

- 文件 tools canonicalize absolute path、`..`、symlink 和新文件 ancestor，并执行 include/exclude scope。
- `bash` 使用 `@anthropic-ai/sandbox-runtime`：macOS 通过 `sandbox-exec`，Linux 通过 bubblewrap。
- workspace 外写入和默认 network 被 OS sandbox 阻止。
- privilege escalation、package install 和 git mutation 还会经过 command preflight；相关 override 仅对当前 dispatch 生效。
- non-TUI 模式不允许启动需要确认的 profiles。

通用边界：

- child 使用独立 in-memory `AgentSession`。
- 不复制 parent conversation，不默认加载 parent extensions、skills 或 prompts。
- 支持 `small`、`standard`、`large` budgets；`large` 需要交互确认。
- 支持 parent cancel、budget abort 和 session shutdown cleanup。
- 中间事件只进入 tool renderer/details；parent model只接收最终结构化结果。
- 不支持 remote tools、递归 subagent 或 pause/resume。

Linux 运行 sandboxed `bash` 需要系统安装 `bubblewrap`、`socat` 和 `ripgrep`；缺失或初始化失败时 fail closed。
