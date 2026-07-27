import { createHash } from "node:crypto";

type SessionRecord = { type?: unknown; id?: unknown; timestamp?: unknown };

export function eventIdentity(record: SessionRecord, rawRecord: string): string {
  const type = typeof record.type === "string" ? record.type : "unknown";
  const id = typeof record.id === "string" && record.id.length > 0 ? record.id : undefined;
  const timestamp = typeof record.timestamp === "string" ? record.timestamp : "";
  const stablePart = id ? `${id}\0${timestamp}` : rawRecord;
  return createHash("sha256").update(`oh-my-pi-usage-v1\0${type}\0${stablePart}`).digest("hex");
}
