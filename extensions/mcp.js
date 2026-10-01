import { readFileSync } from "node:fs";

// `config/mcp.json` is package-owned configuration; Pi resolves env references
// in server definitions when it connects them.
export default function (pi) {
  if (typeof pi.registerMcpServer !== "function") {
    pi.on("session_start", (_event, ctx) => {
      ctx.ui.notify("oh-my-pi MCP configuration requires Pi with native registerMcpServer support. Update Pi to enable it.", "warning");
    });
    return;
  }

  try {
    const { mcpServers = {} } = JSON.parse(readFileSync(new URL("../config/mcp.json", import.meta.url), "utf8"));
    for (const [name, config] of Object.entries(mcpServers)) {
      pi.registerMcpServer(name, { ...config });
    }
  } catch (error) {
    pi.on("session_start", (_event, ctx) => {
      ctx.ui.notify(`Failed to load oh-my-pi MCP configuration: ${error instanceof Error ? error.message : String(error)}`, "warning");
    });
  }
}
