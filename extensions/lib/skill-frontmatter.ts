export function parseSkillFrontmatter(text: string): Record<string, string> | undefined {
  if (!text.startsWith("---\n")) return undefined;
  const end = text.indexOf("\n---", 4);
  if (end < 0) return undefined;
  const raw = text.slice(4, end).trim();
  const data: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^(\w[\w-]*):\s*(.*)$/.exec(line);
    if (!match) continue;
    data[match[1]] = match[2].trim().replace(/^['\"]|['\"]$/g, "");
  }
  return data;
}
