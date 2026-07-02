# Work Issue

## 目标

读取一个 GitHub issue，创建或切换到常规分支，实现、验证，并在用户确认后 commit。

## 默认流程

1. 使用 `gh issue view` 读取 issue。
2. 判断 issue 是否 ready。
3. 检查工作树是否干净。
4. 创建或切换分支。
5. 实现 issue。
6. 运行相关验证。
7. 用中文展示变更摘要和验证结果。
8. 用户确认后才 commit。
9. commit 后停住，不自动创建 PR。

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

## Commit

commit 使用 conventional commits：

```txt
feat: 添加 GitHub workflow skill
fix: 修复 prompt-intercept 加载路径
```

type 用英文，subject 默认可中文。

## 禁止

- 未验证就 commit。
- 未经用户确认就 commit。
- commit 后自动创建 PR。
- 把 `.pi/alignment` 内容写入 commit message、issue 或 PR。
