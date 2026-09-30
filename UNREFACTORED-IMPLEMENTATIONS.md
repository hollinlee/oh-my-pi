# oh-my-pi 未重构实现清单

更新时间：2026-09-30

本文记录当前仍由 `oh-my-pi` 自己维护、尚未完成重构、重新设计或独立拆包的实现。判断依据是当前工作树、`package.json`、`config/packages.json` 和近期重构提交；不把已删除或已由社区 package 接管的功能列为待处理项。

## 结论

当前 `extensions/` 约 8,831 行、`scripts/` 约 1,370 行，共约 10,201 行代码（包含测试，统计 `.ts`、`.rs`、`.mjs`；不含 skills、文档和配置）。主要集中在：

1. `remote-devices`：完整 SSH 设备管理，约 2,993 行。
2. `usage`：本地 usage 采集、SQLite ledger 和 dashboard，约 1,976 行。
3. `status-bar.ts`：状态栏和模型、subagent、usage 展示，751 行。
4. `oh-my-pi.ts`：主控制台、doctor、菜单和兼容性检查，794 行。
5. `serial-devices`：串口 profile、PTY session 和 SSH route，约 497 行。

这些实现仍保留在仓库中。本次是静态盘点，未逐项验证运行行为；“未完成”指本轮拆包与社区替换尚未覆盖，并不表示这些模块从未经过设计。下文的拆分方向是建议，不是已确认的实施计划。

## A. 应优先独立 package 或重新设计

### 1. Remote devices

路径：

- `extensions/remote-devices/`
- `skills/remote-devices/SKILL.md`

规模：约 2,993 行 extension、Rust helper 和测试代码。

当前实现：

- SSH device registry、aliases 和 tags。
- 单命令与批量远程执行。
- SSH connectivity probe、latency 检测和诊断。
- 远程文件读写。
- SSH key 安装。
- 设备配置持久化。
- 面向模型的 remote tools 和 `/remote-devices` command。

未完成的重构或设计：

- 尚未独立为 `@oh-my-pi/remote-devices` package。
- 尚未和社区 `pi-ssh-remote`、`@oresk/pi-remote-tools` 做完整能力对照。
- serial devices 仍是另一个独立实现，设备管理模型没有统一。
- device registry、transport、操作权限和模型工具 surface 仍耦合在同一 extension 中。
- Rust probe helper 与 TypeScript 主实现的边界还没有形成稳定 public API。

建议方向：

- 先设计统一的 device model、transport interface 和 credential boundary。
- 再决定 remote 与 serial 是两个 package，还是统一为一个 device-management package。
- 将 skill、tools、持久化配置和 transport adapter 分层后独立发布。

优先级：**高**。

### 2. Usage dashboard

路径：

- `extensions/usage/`
- `README.md` 中的 `Usage dashboard` 说明

规模：约 1,976 行实现和测试。

当前实现：

- 扫描 Pi session JSONL。
- intake journal 和本地 SQLite ledger。
- Today、7 days、30 days 聚合。
- Models、Providers、Projects breakdown。
- cost/token accounting。
- `/usage` dashboard、purge、health 检查和 lifecycle hooks。

未完成的重构或设计：

- 尚未独立为 status/observability package。
- usage collector、存储 schema、聚合逻辑和 TUI dashboard 仍在同一功能目录内。
- 与 `status-bar.ts` 的数据来源和展示责任还没有统一。
- 历史价格、session source、intake journal 和 purge policy 仍是 oh-my-pi 私有约定。
- 尚未评估社区 `pi-observability`、`pi-cc-extensions` 等实现能否替代或承载这部分能力。

建议方向：

- 将 accounting data contract 和本地 storage API 先独立出来。
- 再把 dashboard 和 status bar 作为不同 UI consumer。
- 独立 package 需要明确隐私边界、迁移策略和历史数据兼容策略。

优先级：**高**。

### 3. Status bar

路径：

- `extensions/status-bar.ts`
- `extensions/status-bar/`
- `extensions/usage/`（存在数据和展示耦合）

规模：主文件 751 行；相关 usage 实现约 1,976 行。

当前实现：

- footer/status bar 渲染。
- model、provider、context、token、TPS 和 usage 状态。
- task timer、subagent 状态和 remote/serial 状态展示。
- 兼容 Pi transcript renderer 的显示约定。

未完成的重构或设计：

- 尚未独立为 `@oh-my-pi/status-bar` package。
- status bar 同时读取多个 extension 的内部状态，跨 extension seam 较多。
- usage、subagent、task timer、remote devices 的状态协议没有统一。
- UI rendering、状态采集和格式化逻辑仍混在主文件中。
- 尚未和 `pi-cc-extensions`、`pi-observability` 做完整取舍。

建议方向：

- 先定义只读 status snapshot/event contract。
- 将 data providers、formatters 和 renderer 分开。
- usage dashboard 与 status bar 共用数据层，但保持独立 UI 入口。

优先级：**高**。

## B. 应重新设计，再决定是否独立

### 4. 主控制台与 doctor

路径：`extensions/oh-my-pi.ts`

规模：794 行。

当前实现：

- `/oh-my-pi` menu 和快捷入口。
- tools、commands、skills、extensions 状态查看。
- `/oh-my-pi doctor` 检查 packages、patches、remote/serial、RTK 等能力。
- APPEND_SYSTEM、compatibility patch 和 package 状态提示。
- 对已拆出功能的兼容性残留检查。

未完成的重构或设计：

- 主控制台承担了过多 package orchestration 责任。
- doctor 仍包含多个外部 package 的具体名称和能力判断。
- 功能状态检查、菜单渲染和动作执行没有清晰分层。
- package manager 与 Pi 原生 package discovery 的边界仍需重新设计。
- 当前文件曾多次因删除模块留下 orphaned code，说明维护边界不稳定。

建议方向：

- 将核心 console 缩小为 package registry/status UI。
- 各独立 package 提供标准化 health/status provider。
- 用 event 或 capability registry 替代主文件中的硬编码检查。

优先级：**中高**。

### 5. 文档、prompt 和配置的迁移收尾

当前仓库已不存在 `extensions/work-issue-autopilot.ts`，不应把它列为待拆分实现。主要 workflow 已迁移到 `pi-development-workflow`。

仍需整理：

- `README.md` 仍介绍已迁移的 alignment/github-workflow skills 和旧 autopilot 入口。
- `REFACTORING.md` 仍将已删除的模块列为保留项或待清理项。
- `config/packages.json` 的历史状态、架构说明和占位日期需要与实际依赖同步。
- `system/APPEND_SYSTEM.md` 及 prompt templates 需要核对是否仍指向已删除工具或 skills。

建议以当前 package manifest 为准统一说明和调用入口。本次仅识别待整理范围，不修改运行规则。

优先级：**中高**。

## C. 中型本地实现，暂可保留但没有完成统一设计

### 6. Serial devices

路径：

- `extensions/serial-devices/`
- `skills/serial-devices/SKILL.md`

规模：约 497 行，包含测试。

当前实现：

- serial profile 管理。
- OS secure storage credential flow。
- local/SSH-hosted `picocom` execution。
- rolling buffer read。
- serial profile validation 和 SSH route。

未完成的重构或设计：

- 尚未和 remote-devices 共享统一 device/transport abstraction。
- profile、credential、PTY lifecycle 和 command execution 的边界仍较紧。
- 尚未决定独立为 `@oh-my-pi/serial-devices`，还是并入 remote-devices。
- serial skill 仍依赖 oh-my-pi 的专用规则，跨 package 复用边界不清。

建议方向：

- 与 remote-devices 一起设计 transport-neutral device model。
- 保留 serial-specific credential 和 PTY adapter；共享 registry、alias 和 status contract。

优先级：**中高**。

### 7. Hookify

路径：`extensions/hookify/`

规模：约 544 行含测试。

当前实现：

- 从 rules 文件读取规则。
- 对 bash/tool 调用做 warn、block 和 interactive confirmation。
- 诊断和规则匹配测试。

未完成的重构或设计：

- 规则 schema、匹配器、决策 UI 和 execution hook 仍放在一个小 package 内。
- 与 `@gotgenes/pi-permission-system` 的职责边界没有正式定义。
- 当前实现已使用 direct UI confirm，但权限策略、审计信息和 permission package 的关系仍需收敛。

建议方向：

- 明确 hookify 是规则前置过滤器，还是 permission system 的 policy frontend。
- 优先复用 permission package 的 decision model，避免两套 permission semantics。

优先级：**中**。

### 8. Proxy extension

路径：`extensions/proxy/`

规模：约 178 行含测试。

当前实现：

- 读取和切换本地代理环境。
- `/proxy` command 和 proxy tools。
- proxy status、host、port 和 confirmation。

未完成的重构或设计：

- proxy state、process environment 和 Pi session scope 的关系仍是本地约定。
- 与 web-access、RTK、remote tools 的网络配置关系没有统一配置模型。
- permission/confirmation 使用 direct UI，尚未与统一权限策略接轨。

建议方向：

- 先保留为轻量 extension。
- 定义 session-scoped proxy API 和统一状态 snapshot；除非出现更多网络 provider，不必立即独立 package。

优先级：**低到中**。

## D. 轻量实现，可保留但应做边界整理

### 9. APPEND_SYSTEM 管理

路径：`extensions/append-system/`、`scripts/install-append-system.mjs`

当前实现：

- managed marker、hash、source status 和 fallback 状态。
- 安装、更新、冲突检测和 doctor 状态。

尚未完成的整理：

- extension、postinstall script、Pi native/project append precedence 需要统一文档和单一状态模型。
- package install 生命周期和 session runtime 检查存在重复逻辑。

优先级：**低**。保留在 oh-my-pi，做边界收敛即可。

### 10. Compatibility patches

路径：

- `scripts/patch-pi-empty-comments.mjs`
- `scripts/patch-pi-transcript-surfaces.mjs`
- `scripts/patch-pi-user-prompt.mjs`
- `scripts/patch-pi-context-summary.mjs`

当前实现：对特定 Pi bundle 做 source-marker guarded patch，包含 backup、checksum、apply/restore 和 status。

尚未完成的整理：

- 这些 patch 依赖 Pi 内部 bundle 结构，属于临时兼容层。
- 没有统一的 version capability matrix。
- Pi 上游修复后需要逐项移除，而不是长期扩大 patch surface。

优先级：**低，但应持续清理**。

### 11. Compact renderer、image limiter、task timer、user prompt

路径：

- `extensions/compact-tool-renderer.ts`
- `extensions/image-result-limiter.ts`
- `extensions/task-timer.ts`
- `extensions/user-prompt.ts`

这些实现规模较小，当前没有明显必要独立 package，但仍存在以下设计工作：

- renderer 与 Pi 原生 transcript surface 的兼容边界需要保持清晰。
- image limiter 的限制策略应和 provider/model capability 对齐。
- task timer 的状态应通过标准 snapshot/event 暴露给 status bar。
- user prompt customization 应避免与 APPEND_SYSTEM 和 Pi 原生 prompt pipeline 重复。

优先级：**低**。

## 已完成替换，不列入未重构清单

以下实现已经删除或迁移，不应继续在 oh-my-pi 内重复实现：

- subagent → `pi-subagents`
- ask user question → `@juicesharp/rpiv-ask-user-question`
- web/Tavily access → `pi-web-access`
- MCP adapter → 已移除，使用 Pi 内置 MCP
- alignment 与 GitHub development workflow → `pi-development-workflow`
- RTK adapter → `pi-rtk-adapter`
- improvement-suggestions 与 improve-architecture → 已删除
- MinerU、model-task、phase-trace 及多个文档/设计 skills → 已删除

## 建议执行顺序

1. 先统一 `remote-devices` 与 `serial-devices` 的 device/transport/credential 设计。
2. 再拆出 status bar 与 usage 的共享数据层，并评估独立 package。
3. 收缩 `extensions/oh-my-pi.ts`，让 package 自己提供 health/status provider。
4. 清理文档和 prompt 中的旧 workflow/autopilot 引用，以独立 package 的实际入口为准。
5. 明确 hookify 与 `pi-permission-system` 的 policy 边界。
6. 最后清理兼容性 patch 和轻量 UI extensions 中的重复状态通道。
