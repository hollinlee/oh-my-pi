# oh-my-pi 重构清单

## 已完成的清理（2025-01）

### 删除的功能
1. ❌ `extensions/subagent/` → `npm:pi-subagents`
2. ❌ `extensions/ask-user/` → `npm:@juicesharp/rpiv-ask-user-question`
3. ❌ `extensions/tavily-tools.ts` → `npm:pi-web-access`
4. ❌ `extensions/mineru/` + `skills/mineru-document-parsing/`
5. ❌ `extensions/model-task/` (3548 行，默认关闭，与 pi-subagents 重叠)
6. ❌ `extensions/phase-trace.ts` + `extensions/phase-trace/` (906 行，UI 风格应该和 status-bar 统一)
7. ❌ `skills/web-motion/`
8. ❌ `skills/feishu-docs/`
9. ❌ `skills/excel-generation/`
10. ❌ `skills/ppt-generation/`
11. ❌ `skills/frontend-design/`

### 新增的社区 packages
```json
{
  "@ff-labs/pi-fff": "^0.11.0",
  "@gotgenes/pi-permission-system": "^32.0.2",
  "@juicesharp/rpiv-ask-user-question": "^2.11.0",
  "@juicesharp/rpiv-todo": "^2.11.0",
  "pi-lens": "*",
  "pi-mcp-adapter": "^2.38.0",
  "pi-rtk-optimizer": "^0.9.0",
  "pi-subagents": "^0.55.0",
  "pi-web-access": "^0.31.0"
}
```

---

## 待清理（下一步）

### 立即替换
1. ❌ `extensions/rtk-adapter.ts` → `npm:pi-rtk-optimizer`
2. ❌ `extensions/permissions/` → `npm:@gotgenes/pi-permission-system`

---

## 待独立 repo 的重型功能

### 高优先级
1. **@oh-my-pi/status-bar** (或 `oh-my-pi-status`)
   - 包含：`extensions/status-bar.ts` + `extensions/usage/`
   - 功能：CC 风格 status bar + usage + TPS summary（支持中转代理场景）
   - 参考：pi-cc-extensions, pi-observability
   - 行数：750 + 15 个文件

2. **@oh-my-pi/remote-devices**
   - 包含：`extensions/remote-devices/` + `skills/remote-devices/`
   - 功能：完整 SSH 远程设备管理（批量操作、device aliases、probe、install keys）
   - 参考：pi-ssh-remote, @oresk/pi-remote-tools
   - 行数：2169

3. **@oh-my-pi/github-workflow**
   - 包含：`extensions/github-workflow/` + `extensions/work-issue-autopilot.ts` + `skills/github-workflow/`
   - 功能：完整 issue/PR autopilot（implementation → verification → commit → PR → review → merge）
   - 参考：pi-github, pi-pr-review
   - 行数：工作流 skill + autopilot 171 行

### 中优先级
4. **@oh-my-pi/serial-devices**
   - 包含：`extensions/serial-devices/` + `skills/serial-devices/`
   - 功能：串口设备管理
   - 考虑：可能与 remote-devices 合并为统一的设备管理方案

5. **@oh-my-pi/goal-management**（需单独讨论设计）
   - 包含：`skills/alignment/` 的未来重新设计
   - 功能：统一的 Goal 管理：alignment → planning → tracking → completion audit
   - 整合：当前 alignment skill + rpiv-todo + pi-goal-x 的策略设计

---

## 保留在 oh-my-pi 的轻量级功能

### Skills (纯指导性)
- ✅ `skills/alignment/` - 对齐方法论（短期保留，中期独立设计）
- ✅ `skills/design-pi-capability/` - Pi 能力设计指导
- ✅ `skills/diagnosing-bugs/` - Debug 流程指导
- ✅ `skills/github-workflow/` - GitHub 工作流指导（配合独立 extension）
- ✅ `skills/find-skills/` - Skill 发现
- ✅ `skills/improvement-suggestions/` - 改进建议收集
- ✅ `skills/improve-architecture/` - 架构改进建议

### Extensions (轻量级)
- ✅ `extensions/oh-my-pi.ts` (850 行) - 主控制台
- ✅ `extensions/compact-tool-renderer.ts` (252 行) - 紧凑工具渲染
- ✅ `extensions/image-result-limiter.ts` (106 行) - 图片结果限制
- ✅ `extensions/task-timer.ts` (158 行) - 任务计时
- ✅ `extensions/user-prompt.ts` (59 行) - 用户 prompt 定制
- ✅ `extensions/append-system/` - APPEND_SYSTEM 管理
- ✅ `extensions/hookify/` - Hooks 系统
- ✅ `extensions/improvements/` - 改进建议收集
- ✅ `extensions/proxy/` - 代理配置
- ✅ `extensions/lib/` - 共享库
- ✅ `extensions/work-issue-autopilot.ts` - 暂时保留，待与 github-workflow 合并

---

## 架构原则

1. **轻量级功能留在 oh-my-pi**
   - Skills：纯指导性，无复杂实现
   - Extensions：< 300 行，无重型依赖

2. **重型功能独立 repo/package**
   - 复杂实现（> 500 行）
   - 需要专门维护的功能
   - 有外部系统集成的功能

3. **优先使用社区成熟 packages**
   - 相同功能优先选社区实现
   - 降低维护成本
   - 专注于独特价值

---

## 保留在 oh-my-pi 的轻量级功能

### Skills (纯指导性)
- ✅ `skills/alignment/` - 对齐方法论（短期保留，中期独立设计）
- ✅ `skills/github-workflow/` - GitHub 工作流指导（配合独立 extension）
- ✅ `skills/improvement-suggestions/` - 改进建议收集
- ✅ `skills/improve-architecture/` - 架构改进建议

### Extensions (轻量级)
- ✅ `extensions/append-system/` - APPEND_SYSTEM 管理
- ✅ `extensions/proxy/` - 代理配置
- ✅ `extensions/remote-devices/` - 远程设备管理
- ✅ `extensions/serial-devices/` - 串口设备管理
- ✅ `extensions/usage/` - usage 统计和 dashboard
- ✅ `extensions/work-issue-autopilot.ts` - 暂时保留，待与 github-workflow 合并

本清单中的旧版 `oh-my-pi.ts`、hookify、image-result-limiter 和共享 `lib` 已删除。

1. **立即**: 删除 rtk-adapter 和 permissions，已添加社区替代
2. **Phase 1**: 创建 `@oh-my-pi/status-bar`（最简单，独立性强）
3. **Phase 2**: 创建 `@oh-my-pi/remote-devices`（优先级最高）
4. **Phase 3**: 创建 `@oh-my-pi/github-workflow`（优先级最高）
5. **Phase 4**: 单独讨论 Goal 管理策略设计
