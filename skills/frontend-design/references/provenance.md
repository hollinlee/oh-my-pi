# Provenance

## Upstream source

本 capability 受 Anthropic `frontend-design` skill 的设计原则启发：

- Repository: https://github.com/anthropics/skills
- Source: https://github.com/anthropics/skills/blob/2235be7c60b551f5de82ade908fd3816455afcda/skills/frontend-design/SKILL.md
- Upstream commit: `2235be7c60b551f5de82ade908fd3816455afcda`
- Commit date: `2026-06-09T19:33:41Z`
- Retrieved source SHA-256: `1608ea77fbb6fc30d13a97d12cfa8ebf31358d40f0dd97beed24829d6b3f45dd`
- Upstream license: Apache License 2.0，副本见 `../LICENSE.anthropic.txt`

## Local adaptation

本地实现不是上游文件的逐字镜像，也不自动跟随上游更新。它重新组织并独立表述以下通用原则：

- 视觉方向应扎根于具体 subject、audience 和 page job。
- typography、structure、motion 和内容都应承担设计意义。
- 复杂度必须与视觉方向匹配。
- 页面应有一个主要 signature，并主动拒绝模板化默认选择。
- 设计前先形成紧凑方向，构建后再做自我检查。

本地新增机制包括：

- 窄范围自动触发和明确负向边界。
- compact design contract 的固定字段。
- 与 pi progressive disclosure 配合的 references 结构。
- 后续由 oh-my-pi 维护的 style routing、组合限制和验证状态。

上游变化只进行人工 semantic review。更新来源 commit 时，应重新检查 license、原则映射和本地表达，不应机械覆盖本地文件。
