# Subagent

`subagent` 提供 bounded、isolated、read-only 的通用任务委派。

第一版边界：

- child 使用独立 in-memory `AgentSession`。
- 只启用 `read`、`grep`、`find`、`ls` 和 structured result tool。
- 不复制 parent conversation，不默认加载 parent extensions、skills 或 prompts。
- 支持 `small`、`standard`、`large` budgets；`large` 需要交互确认。
- 支持 parent cancel、budget abort 和 session shutdown cleanup。
- 中间事件只进入 tool renderer/details；parent model只接收最终结构化结果。
- 不支持写文件、`bash`、network、remote、git mutation、递归 subagent 或 pause/resume。

后续 capability profiles 在 runtime enforcement 通过 adversarial tests 后再开放。
