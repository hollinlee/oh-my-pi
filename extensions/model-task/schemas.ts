import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";

export const MODEL_TASK_SCHEMA_VERSION = 1 as const;

export const TaskStatusSchema = StringEnum([
  "queued",
  "running",
  "blocked",
  "needs_review",
  "succeeded",
  "failed",
  "cancelled",
] as const);
export type TaskStatus = Static<typeof TaskStatusSchema>;

export const ModelRoleSchema = StringEnum(["decision", "execution", "review"] as const);
export type ModelRole = Static<typeof ModelRoleSchema>;

export const ModelRefSchema = Type.Object({
  provider: Type.String({ minLength: 1 }),
  model: Type.String({ minLength: 1 }),
  fallbacks: Type.Optional(Type.Array(Type.Object({
    provider: Type.String({ minLength: 1 }),
    model: Type.String({ minLength: 1 }),
  }, { additionalProperties: false }))),
}, { additionalProperties: false });
export type ModelRef = Static<typeof ModelRefSchema>;

export const ModelConfigSchema = Type.Partial(Type.Object({
  decision: ModelRefSchema,
  execution: ModelRefSchema,
  review: ModelRefSchema,
}, { additionalProperties: false }));
export type ModelConfig = Static<typeof ModelConfigSchema>;

export const ResolvedModelSchema = Type.Object({
  provider: Type.String({ minLength: 1 }),
  model: Type.String({ minLength: 1 }),
  fallbacks: Type.Optional(Type.Array(Type.Object({
    provider: Type.String({ minLength: 1 }),
    model: Type.String({ minLength: 1 }),
  }, { additionalProperties: false }))),
  role: ModelRoleSchema,
  source: StringEnum(["global", "project", "task"] as const),
}, { additionalProperties: false });
export type ResolvedModel = Static<typeof ResolvedModelSchema>;

export const EscalationSchema = Type.Object({
  reason: Type.String({ minLength: 1 }),
  summary: Type.String({ minLength: 1 }),
  attempted: Type.Array(Type.String()),
  evidence: Type.Array(Type.Object({
    claim: Type.String({ minLength: 1 }),
    source: Type.String({ minLength: 1 }),
  }, { additionalProperties: false })),
  question: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export type Escalation = Static<typeof EscalationSchema>;

export const TaskEventSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  at: Type.String({ format: "date-time" }),
  kind: StringEnum([
    "status",
    "phase",
    "model",
    "tool",
    "verification",
    "escalation",
    "report",
  ] as const),
  summary: Type.String({ minLength: 1 }),
  details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
}, { additionalProperties: false });
export type TaskEvent = Static<typeof TaskEventSchema>;

export const TaskSpecSchema = Type.Object({
  schemaVersion: Type.Literal(MODEL_TASK_SCHEMA_VERSION),
  id: Type.String({
    minLength: 1,
    maxLength: 120,
    pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$",
  }),
  goal: Type.String({ minLength: 1 }),
  context: Type.Array(Type.String()),
  constraints: Type.Array(Type.String()),
  scope: Type.Object({
    cwd: Type.String({ minLength: 1 }),
    includePaths: Type.Array(Type.String()),
    excludePaths: Type.Array(Type.String()),
  }, { additionalProperties: false }),
  acceptanceCriteria: Type.Array(Type.String(), { minItems: 1 }),
  escalationRules: Type.Array(Type.String()),
  modelConfig: Type.Optional(ModelConfigSchema),
  createdAt: Type.String({ format: "date-time" }),
}, { additionalProperties: false });
export type TaskSpec = Static<typeof TaskSpecSchema>;

export const VerificationRecordSchema = Type.Object({
  command: Type.String({ minLength: 1 }),
  outcome: Type.String({ minLength: 1 }),
  exitCode: Type.Optional(Type.Integer()),
  logPath: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const TaskResultSchema = Type.Object({
  summary: Type.String(),
  models: Type.Array(ResolvedModelSchema),
  changes: Type.Array(Type.Object({
    path: Type.String({ minLength: 1 }),
    summary: Type.String({ minLength: 1 }),
  }, { additionalProperties: false })),
  verification: Type.Array(VerificationRecordSchema),
  risks: Type.Array(Type.String()),
  unresolved: Type.Array(Type.String()),
  nextActions: Type.Array(Type.String()),
  finalReport: Type.Optional(Type.String()),
}, { additionalProperties: false });
export type TaskResult = Static<typeof TaskResultSchema>;

export const TaskCheckpointSchema = Type.Object({
  schemaVersion: Type.Literal(MODEL_TASK_SCHEMA_VERSION),
  revision: Type.Integer({ minimum: 0 }),
  task: TaskSpecSchema,
  status: TaskStatusSchema,
  phase: Type.String({ minLength: 1 }),
  updatedAt: Type.String({ format: "date-time" }),
  activeModel: Type.Optional(ResolvedModelSchema),
  events: Type.Array(TaskEventSchema),
  escalation: Type.Optional(EscalationSchema),
  result: Type.Optional(TaskResultSchema),
}, { additionalProperties: false });
export type TaskCheckpoint = Static<typeof TaskCheckpointSchema>;
