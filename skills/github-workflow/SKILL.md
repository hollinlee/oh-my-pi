---
name: github-workflow
description: GitHub 驱动的工程工作流。用于 /to-issues、/work-issue、/create-pr、/handle-review、/merge-pr：从已确认计划创建 issues，到实现 issue、创建 PR、处理 review、确认后合并；使用 gh CLI，公开 issue/PR 不得引用私有 .pi/alignment。
---

# GitHub Workflow

## 目标

把已经通过 `/grill` 和 `/plan` 对齐过的工作推进到 GitHub 执行链路：

```txt
/grill -> /plan -> /to-issues -> /work-issue -> /create-pr -> /handle-review -> /merge-pr
```

第一版使用 skill + prompt templates + `gh` CLI，不做 GitHub extension/tool。

## 可见性边界

`.pi/alignment/` 是私有思考空间。GitHub Issues 和 PRs 是公开或 repo 可见的执行记录。

硬规则：

- Issue 和 PR 不得引用 `.pi/alignment` 文件或路径。
- 可以读取 `.pi/alignment` 来理解上下文，但必须把内容改写成 issue/PR 自身可读的公开上下文。
- GitHub issue/PR/review 摘要默认用中文。
- 技术标识保留英文，例如命令、文件名、branch prefix、conventional commit type。

## 命令边界

- `/to-issues`：把已确认 plan 拆成 GitHub issue drafts；用户确认后才创建 issues。
- `/work-issue`：读取一个 issue，创建/切换分支，实现、验证；用户确认后才 commit；不自动创建 PR。
- `/create-pr`：生成 PR title/body；用户确认后才创建 PR；不 merge。
- `/handle-review`：读取并分类 review comments，提出处理策略；确认后处理；不 merge。
- `/merge-pr`：检查 CI、review、unresolved comments、分支状态；用户确认后才 merge。

## 默认约定

- 一个 issue = 一个 vertical slice = 一个 PR 候选。
- 不引入 triage/label 状态机，优先使用 GitHub 原生状态。
- branch 使用 `feat/`、`fix/`、`chore/`、`docs/`、`refactor/`、`test/` 等常规前缀。
- commit 使用 conventional commits，type 英文，subject 默认可中文。
- merge 默认 squash merge + delete branch，但必须用户确认。

## 按需参考

- issue draft 和创建见 `references/issues.md`。
- issue 实现见 `references/work-issue.md`。
- PR 创建见 `references/pr.md`。
- review 处理见 `references/review.md`。
- merge gate 见 `references/merge.md`。
