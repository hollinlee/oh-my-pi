import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyAppendSystemFallback, getAppendSystemStatus } from "./status.ts";

export default function appendSystemExtension(pi: ExtensionAPI) {
  pi.on("before_agent_start", (event, ctx) => {
    const status = getAppendSystemStatus({
      cwd: ctx.cwd,
      projectTrusted: ctx.isProjectTrusted(),
      nativeAppendConfigured: event.systemPromptOptions.appendSystemPrompt !== undefined,
    });
    if (status.mode !== "bundled") return;
    return { systemPrompt: applyAppendSystemFallback(event.systemPrompt, status) };
  });
}
