import { truncateHead } from "@earendil-works/pi-coding-agent";

const TRUNCATION_NOTICE = "\n[Subagent tool output truncated to preserve context. Narrow the query or delegate a smaller task.]";

export function limitTextOutput(content: any[], maxBytes: number): any[] {
  let remaining = maxBytes;
  let truncated = false;
  const limited = content.map((part) => {
    if (part?.type !== "text" || typeof part.text !== "string") return part;
    const bytes = Buffer.byteLength(part.text, "utf8");
    if (bytes <= remaining) {
      remaining -= bytes;
      return part;
    }
    truncated = true;
    if (remaining <= 0) return { ...part, text: "" };
    const value = truncateHead(part.text, { maxBytes: remaining, maxLines: 2_000 });
    remaining = 0;
    return { ...part, text: value.content };
  });
  if (!truncated) return content;
  const lastText = limited.findLastIndex((part) => part?.type === "text");
  if (lastText >= 0) limited[lastText] = { ...limited[lastText], text: `${limited[lastText].text}${TRUNCATION_NOTICE}` };
  else limited.push({ type: "text", text: TRUNCATION_NOTICE.trimStart() });
  return limited;
}

export function contentBytes(content: any[]): number {
  return content.reduce((total, part) => {
    if (part?.type === "text" && typeof part.text === "string") return total + Buffer.byteLength(part.text, "utf8");
    if (part?.type === "image" && typeof part.data === "string") return total + Buffer.byteLength(part.data, "utf8");
    return total;
  }, 0);
}
