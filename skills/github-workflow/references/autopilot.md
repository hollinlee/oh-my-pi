# Work Issue Autopilot

## 目标

按用户显式给出的有序 issue 队列，逐个完成 implementation、verification、PR、review 和 merge。当前 issue 成功 merge 并同步 `main` 后，才能处理下一个。

## 输入

接受空格分隔的 issue number、`#number` 或 GitHub issue URL：

```txt
/work-issue 51 52 53
/work-issue #51 https://github.com/owner/repo/issues/52
```

规则：

- 至少提供一个 issue。
- 保持输入顺序。
- 拒绝重复 issue，避免重复处理。
- 不扫描 open backlog，不自行选择下一个 issue。
- URL 指向其他 repo 或 target repo 不明确时停止。

## 队列不变量

- 同一时间只处理一个 issue。
- 每个 issue 使用独立 conventional branch 和 PR。
- 当前 issue 未 merge 时，不开始后续 issue。
- 任一 human decision gate 触发时，整个队列暂停。
- GitHub artifacts 不得引用私有 alignment 文件或路径。

## 每个 issue 的流程

### 1. Readiness 和基线

1. 使用 `gh issue view` 读取 issue。
2. 判断目标、范围、非目标、验收和验证方式是否足够明确。
3. 检查 issue 是否已有 open PR、已关闭或已被实现；状态不清楚时停止。
4. 检查工作树干净且当前改动可安全归属。
5. 切到 base branch，使用 fast-forward-only 方式同步远端。
6. 创建或切换到与 issue 明确对应的 conventional branch。

### 2. Implementation 和 verification

1. 只实现当前 issue。
2. 运行 issue 指定和改动相关的验证。
3. verification failure 若有唯一、局部、in-scope 修复，可继续修复并重跑。
4. 修复方向不唯一、需要降低验收标准或扩大 scope 时停止。
5. 验证后确认没有无关改动和敏感内容。

### 3. Commit、push 和 PR

按 `pr.md` 自动完成：

1. 生成 conventional commit message。
2. commit 当前 issue 的改动。
3. push branch。
4. 生成中文 PR title/body。
5. PR body 包含 `Summary`、`Verification`、`Risks` 和 `Closes #<issue>`。
6. 创建 PR。

无需在 commit 或 PR creation 前请求确认。若无法识别改动归属、issue 或 PR 语义，则停止。

### 4. Checks 和 review

1. 等待 required checks/review 完成，但不得无限等待。
2. 按 `review.md` 分类和处理 comments。
3. 自动处理明确、in-scope 的 must-fix 和 question。
4. 修改后验证、commit/push、回复并 resolve 已处理 threads。
5. 评论 `@sourcery-ai review` 并读取新 review。
6. 最多执行 2 轮 review/fix/re-review。
7. 只有低价值、重复、nit 或 out-of-scope 建议时，说明理由并停止追逐，不因此阻塞 merge。

### 5. Merge 和下一个 issue

1. 按 `merge.md` 检查 authoritative blocking conditions。
2. 无 blocker 时执行 squash merge + delete branch。
3. 切回 base branch并 fast-forward-only 同步远端。
4. 确认 issue 已关闭或 PR 的 closing linkage 正确。
5. 确认工作树干净、feature branch 状态清楚。
6. 展示当前 issue 的简短结果。
7. 继续队列中的下一个 issue。

## Human decision gates

出现以下任一情况必须停止，不得继续当前决策或启动后续 issue：

- issue 不 ready或验收标准不明确。
- scope change 或需要修改已确认非目标。
- 审美、UX、API 语义存在多个合理方案。
- 安全、权限、迁移、数据删除或破坏性操作缺少明确授权。
- 工作树包含无法归属或可能被覆盖的改动。
- verification failure 且修复方向不唯一。
- review 意见冲突，或处理建议会扩大 scope。
- 两轮复审后仍有 must-fix/blocking thread。
- required checks 长时间 pending、失败原因不明确或外部服务不可用。
- authoritative merge blocker 无法自动消除。
- repo 不支持 squash merge且没有已明确的替代 strategy。
- GitHub 写操作的 target repo、issue、branch 或 PR 无法可靠识别。

## 自动修复边界

可以直接处理：

- 明确、局部、可验证的 implementation defect。
- 与验收标准直接相关的 must-fix。
- 答案可以从代码、issue 或验证结果确认的 question。
- 不改变 public behavior 的低风险维护修复。

必须停止：

- 新功能、新配置或新兼容层。
- 审美偏好和多个合理 UI 方案。
- 降低安全、测试或验收标准。
- 数据迁移、权限变化或破坏性操作。

## 输出降噪

每个 issue 默认只输出：

- readiness 结论或停止原因。
- 最终变更摘要和验证结果。
- PR URL、review 结果和 merge commit。
- 剩余风险。

不要为常规读取、commit、push、轮询 checks 等步骤持续输出过程旁白。
