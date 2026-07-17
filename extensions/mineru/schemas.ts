export type MineruModel = "vlm" | "pipeline";

export type MineruParseParams = {
  path?: string;
  job_id?: string;
  model?: MineruModel;
  ocr?: boolean;
  language?: string;
  max_wait_seconds?: number;
};

export type MineruJobManifest = {
  version: 1;
  jobId: string;
  batchId: string;
  sourcePath: string;
  filename: string;
  model: MineruModel;
  ocr: boolean;
  language: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  resultPath?: string;
  traceId?: string;
  characters?: number;
  errorCode?: string;
  errorMessage?: string;
};

export type MineruFailureCategory = "auth" | "quota" | "rate-limit" | "input" | "service" | "timeout" | "cancelled" | "unsafe-result";

export type MineruParseResult = {
  status: "ready" | "failed" | "timed-out-local" | "cancelled-local";
  jobId?: string;
  batchId?: string;
  state?: string;
  model?: MineruModel;
  ocr?: boolean;
  language?: string;
  resultPath?: string;
  characters?: number;
  preview?: string;
  retentionUntil?: string;
  warning?: string;
  error?: string;
  code?: string;
  traceId?: string;
  stage?: string;
  category?: MineruFailureCategory;
  retryable?: boolean;
  remoteMayContinue?: boolean;
  suggestedAction?: string;
};
