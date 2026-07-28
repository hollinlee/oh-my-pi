---
name: github-workflow
description: GitHub 驱动的工程工作流。用于 /to-issues、/work-issue、/create-pr、/handle-review、/merge-pr：从已确认计划创建 issues；按显式队列自动实现、验证、提交、创建 PR、处理 review 并合并；使用 gh CLI，公开 issue/PR 不得引用私有 .pi/alignment。
---

# GitHub Workflow

## 目标

把已经通过 `/grill` 和 `/plan` 对齐过的工作推进到 GitHub：

```txt
/grill -> /plan -> /to-issues -> /work-issue <issue...>
```

`/work-issue` 是显式有序队列的 end-to-end autopilot。`/create-pr`、`/handle-review` 和 `/merge-pr` 是同一 autopilot 的阶段恢复入口。它们从指定阶段开始，满足条件时自动推进到 merge。完整链路：

```txt
implementation -> verification -> commit -> PR -> review -> merge -> next issue
```

第一版继续使用 skill + prompt templates + `gh` CLI，不做 GitHub extension/tool。

## 可见性边界

`.pi/alignment/` 是私有思考空间。GitHub Issues 和 PRs 是公开或 repo 可见的执行记录。

硬规则：

- Issue、commit message、PR 和 review reply 不得引用 `.pi/alignment` 文件或路径。
- 可以读取 `.pi/alignment` 理解上下文，但必须改写成 artifact 自身可读的公开上下文。
- GitHub issue/PR/review 摘要默认用中文。
- 命令、路径、branch prefix、API 名和 conventional commit type 保留英文。

## 命令边界

- `/to-issues`：把已确认 plan 拆成 issue drafts；用户确认后创建 issues，并输出可复制的有序 `/work-issue` 队列。
- `/work-issue`：只处理显式传入的 issue number/URL；按顺序自动实现、验证、commit、push、创建 PR、处理 review、合并并同步 `main`。
- `/create-pr`：autopilot recovery entry；当前分支状态明确时自动 commit、push、创建 PR，然后继续 checks、review 和 merge。
- `/handle-review`：autopilot recovery entry；自动分类并处理不改变 scope 的初审反馈，验证、commit/push、resolve threads，然后继续 merge。
- `/merge-pr`：autopilot merge entry；按 `references/merge.md` 检查后 merge。

本节是命令起始阶段和自动续行边界的权威来源。用户明确要求“只创建 PR”“只处理 review”或指定其他停止点时，以该显式限制为准；否则默认自动推进。

## 自动化边界

`/work-issue <issue...>` 本身授权对显式队列执行 branch、commit、push、PR creation、review reply、squash merge 和 branch deletion。`/create-pr` 与 `/handle-review` 的调用也授权从各自阶段继续执行后续 checks、review、merge 和 branch deletion；`/merge-pr` 授权 merge 和 branch deletion。不要在这些常规边界重复请求确认。

除用户显式指定的停止点外，只有 `references/autopilot.md` 定义的 human decision gate 出现时才停止。队列模式下，停止当前 issue 后不得启动后续 issue。

## 默认约定

- 一个 issue = 一个 vertical slice = 一个 PR。
- 不引入 triage/label 状态机，优先使用 GitHub 原生状态。
- branch 使用 `feat/`、`fix/`、`chore/`、`docs/`、`refactor/`、`test/` 等常规前缀。
- commit 使用 conventional commits，type 英文，subject 默认中文。
- merge 默认 squash merge + delete branch。
- Sourcery 仅用于一次初审；处理完初审反馈后不主动触发或等待重审。
- `references/merge.md` 是 merge blocking conditions 唯一权威来源。

## 输出原则

默认只展示：

- 已产生的 artifact 或最终 URL。
- 关键判断和取舍。
- 验证结果。
- 风险和停止原因。

不输出无助于判断的过程旁白、文件读取流水账或重复状态播报。安全风险、scope change 和失败诊断仍需完整说明。

## 按需参考

- issue draft 和创建：`references/issues.md`
- end-to-end 队列和停止点：`references/autopilot.md`
- issue implementation：`references/work-issue.md`
- commit/push/PR：`references/pr.md`
- review：`references/review.md`
- authoritative merge gate：`references/merge.md`
