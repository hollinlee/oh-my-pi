---
description: 按显式有序 issue 队列自动实现、验证、创建 PR、处理 review 并合并
argument-hint: "<issue-number-or-url> [更多 issue...]"
---

请使用 `github-workflow` skill 的 end-to-end autopilot 处理以下显式有序 GitHub issue 队列：

$ARGUMENTS

要求：

- 只处理参数中显式给出的 issues，严格保持顺序；不要扫描其他 open issues。
- 对每个 issue 使用 `gh issue view` 读取并判断 readiness。
- 检查工作树；无法安全归属已有改动时停止整个队列。
- 使用 conventional branch，确保每个 issue 独立 branch 和 PR。
- 自动实现并运行相关验证。
- verification 成功后自动生成 conventional commit、commit 并 push。
- 自动生成中文 PR title/body；body 包含 Summary、Verification、Risks 和 `Closes #<issue>`。
- 自动创建 PR，不在 commit 或 PR creation 前做二次确认。
- 自动读取并分类 review comments；处理不改变 scope 的 must-fix 和 question。
- PR 创建后只评论一次 `@sourcery-ai review` 并等待初审。
- 初审 fix 后自动验证、commit/push、回复、resolve threads；不主动触发或等待 Sourcery 重审，直接进入 merge gate。
- 按 `references/merge.md` 检查 authoritative blocking conditions；无 blocker 时自动 squash merge + delete branch。
- merge 后切回并同步 `main`，确认工作树干净，再处理下一个 issue。
- runtime guard 激活时，使用 `work_issue_checkpoint` 记录 meaningful progress、每个已 merge issue、human decision gate 和完整队列完成；branch、commit、push、PR creation 或单个 issue merge 都不是最终停止点。
- 只有真实 tool result 返回错误时才能声称工具不可用；不得把隐藏 bootstrap 或普通 `stopReason: stop` 描述为工具通道被禁用。
- 出现 `references/autopilot.md` 的 human decision gate 时停止整个队列，说明当前 artifact、阻塞和需要用户决定的唯一关键问题。
- GitHub artifacts 不得引用 `.pi/alignment` 或其他私有对齐文件。
- 用中文输出最终 artifact、验证、风险和停止原因；不要输出无判断价值的过程旁白。
