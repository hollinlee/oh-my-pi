import { readFileSync } from "node:fs";

// Package-owned registration: no writes to the user's mcp.json or settings.json.
export default function (pi) {
  if (typeof pi.registerMcpServer !== "function") {
    pi.on("session_start", (_event, ctx) => {
      ctx.ui.notify("Context7 requires Pi with native registerMcpServer support. Update Pi to enable it.", "warning");
    });
    return;
  }

  const { mcpServers } = JSON.parse(readFileSync(new URL("../config/mcp.json", import.meta.url), "utf8"));
  const config = { ...mcpServers.context7 };
  if (process.env.CONTEXT7_API_KEY) {
    config.headers = { ...config.headers, CONTEXT7_API_KEY: "${CONTEXT7_API_KEY}" };
  }
  pi.registerMcpServer("context7", config);
}
