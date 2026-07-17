export type MineruModel = "vlm" | "pipeline";

export type MineruParseParams = {
  path: string;
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
};

export type MineruParseResult = {
  status: "ready" | "failed";
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
  traceId?: string;
};
