export const RETRY_DELAYS_MS = [1_000, 2_000, 2_000, 5_000, 9_000, 20_000, 38_000, 38_000, 38_000, 40_000] as const;
export const MAX_RETRIES = RETRY_DELAYS_MS.length;

export function retryDelayMs(attempt: number, providerDelayMs?: number): number {
  if (providerDelayMs !== undefined && Number.isFinite(providerDelayMs) && providerDelayMs >= 0) return providerDelayMs;
  const index = Math.max(0, Math.min(RETRY_DELAYS_MS.length - 1, Math.floor(attempt) - 1));
  return RETRY_DELAYS_MS[index]!;
}

export function retryAttemptLabel(attempt: number): string {
  return `${Math.max(1, Math.floor(attempt))}/${MAX_RETRIES}`;
}

export function runtimeStageLabel(stage: string): string {
  const normalized = stage.trim().toLowerCase();
  if (!normalized || normalized.includes("connect") || normalized.includes("provider")) return "Waiting";
  if (normalized.includes("think") || normalized.includes("reason")) return "Working";
  if (normalized.includes("retry")) return "Retrying";
  if (normalized.includes("respond") || normalized.includes("answer")) return "Responding";
  return stage.trim() || "Waiting";
}

export function turnSummaryLabel(stopReason: string | undefined, elapsed: string): string {
  const normalized = (stopReason ?? "").toLowerCase();
  const label = normalized === "aborted" || normalized === "cancelled" ? "Cancelled" : normalized === "error" ? "Failed" : "Done";
  return `✻ ${label}${label === "Done" ? " in" : " after"} ${elapsed}`;
}
