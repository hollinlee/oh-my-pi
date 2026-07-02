# Work Issue

## 目标

读取一个 GitHub issue，创建或切换到常规分支，实现、验证，展示摘要，然后停住。commit 由 `/create-pr` 负责。

## 默认流程

1. 使用 `gh issue view` 读取 issue。
2. 判断 issue 是否 ready。
3. 检查工作树是否干净。
4. 创建或切换分支。
5. 实现 issue。
6. 运行相关验证。
7. 用中文展示变更摘要和验证结果。
8. 停住，不 commit。
9. 提醒用户之后可运行 `/create-pr` 处理 commit、push 和 PR 创建。

## Branch naming

使用常规前缀，不使用 `agent/`：

```txt
feat/<issue-number>-<short-slug>
fix/<issue-number>-<short-slug>
chore/<issue-number>-<short-slug>
docs/<issue-number>-<short-slug>
refactor/<issue-number>-<short-slug>
test/<issue-number>-<short-slug>
```

## Commit boundary

`/work-issue` 不 commit。

commit 由 `/create-pr` 负责，因为 commit 确认和 PR 创建确认属于同一交付边界。

## 禁止

- 在 `/work-issue` 中 commit。
- 在 `/work-issue` 后自动创建 PR。
- 把 `.pi/alignment` 内容写入 issue、commit message 或 PR。
