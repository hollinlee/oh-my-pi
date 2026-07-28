# Work Issue

## 目标

`/work-issue` 是显式有序 issue 队列的 end-to-end autopilot。完整队列规则、流程和 human decision gates 以 `autopilot.md` 为准。

## 默认流程

对于每个显式 issue：

1. `gh issue view` 读取并检查 readiness。
2. 检查干净工作树并同步 base branch。
3. 创建或切换 conventional branch。
4. 实现当前 issue。
5. 运行相关验证。
6. 自动 commit、push 和创建 PR。
7. 只请求一次 Sourcery 初审；处理并 resolve 初审反馈后不等待重审。
8. 按 `merge.md` 检查并 squash merge + delete branch。
9. 同步 `main`，确认干净后处理下一个 issue。

无需在 commit、PR creation 或 merge 前重复确认。`/work-issue <issue...>` 本身是对显式队列的完整 workflow 授权。

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

## Queue boundary

- 只处理参数中显式提供的 issue。
- 不扫描 backlog。
- 当前 issue 未成功 merge 时，不开始下一个。
- 停止后保留当前 artifact 状态，并清楚说明恢复入口。

## 禁止

- 跳过 readiness、verification、review 或 merge blockers。
- 把多个 issues 混入同一 branch/PR。
- 在 human decision gate 出现后继续猜测。
- 把私有 alignment 内容写入 issue、commit message、PR 或 review reply。
