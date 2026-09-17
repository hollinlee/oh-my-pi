---
name: improvement-suggestions
description: Identify high-confidence oh-my-pi capability friction and, only after explicit user confirmation, record a redacted improvement suggestion for later review.
---

# Improvement Suggestions

Use this workflow when the current task exposes a likely oh-my-pi capability gap.

## Suggest only high-confidence friction

Suggest at most once for the same issue in one task when one or more of these apply:

- The same tool is retried because output is missing, truncated, or unusable.
- A tool returns an error and the requested task cannot proceed with the available capability.
- The workflow needs a repeated workaround such as base64, manual chunking, or repeated probing.
- The user explicitly says a capability is missing or difficult to use.
- The task remains incomplete because an oh-my-pi tool, skill, or extension lacks required behavior.

A normal one-off command failure is not enough. Do not infer a feature request from an unrelated application error.

## User confirmation boundary

Do not write a suggestion automatically. First state a concise proposed suggestion and the evidence you intend to keep. Ask whether to save it. The user may edit the proposed fields or cancel.

After confirmation, call the `improvement_suggestion` tool with the edited, redacted context and `confirmed: true`. If the user declines, do not call it. Never modify source code, create an issue, upload data, or save a full transcript as part of this workflow.

## Context to include

Keep only the minimum reproducible context:

- user goal summary
- affected tool, skill, or extension
- key non-sensitive facts from tool results
- error, truncation, retry, or workaround evidence
- capability gap and suggested direction
- session/task identifiers when available

Do not include full conversation history. Remove tokens, passwords, credentials, private addresses, sensitive command arguments, and business data. The storage tool applies a final recursive redaction pass.

## Available runtime facts

The session system prompt may include bounded facts from recent tool calls: call/error/truncation counts, output size, elapsed time, and latest status. Use them as evidence; do not treat them as an automatic trigger. Extension facts are signals, not semantic decisions.
