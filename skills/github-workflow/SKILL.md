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

`/work-issue` 是显式有序队列的 end-to-end autopilot。它对每个 issue 自动完成：

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
- `/create-pr`：recovery/manual entry；当前分支状态明确时自动 commit、push 和创建 PR，不做低价值二次确认；不 merge。
- `/handle-review`：recovery/manual entry；自动分类并处理不改变 scope 的 review，验证、commit/push、resolve threads 并触发复审；不 merge。
- `/merge-pr`：调用本身视为 merge 信号；按 `references/merge.md` 检查后 merge。

## 自动化边界

`/work-issue <issue...>` 本身授权对显式队列执行 branch、commit、push、PR creation、review reply、squash merge 和 branch deletion。不要在这些常规边界重复请求确认。

只有 `references/autopilot.md` 定义的 human decision gate 出现时才停止。停止当前 issue 后不得启动队列后续 issue。

## 默认约定

- 一个 issue = 一个 vertical slice = 一个 PR。
- 不引入 triage/label 状态机，优先使用 GitHub 原生状态。
- branch 使用 `feat/`、`fix/`、`chore/`、`docs/`、`refactor/`、`test/` 等常规前缀。
- commit 使用 conventional commits，type 英文，subject 默认中文。
- merge 默认 squash merge + delete branch。
- review/fix/re-review 最多 2 轮。
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
