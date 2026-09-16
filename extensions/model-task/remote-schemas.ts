import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";

export const REMOTE_EXPERIMENT_SCHEMA_VERSION = 1 as const;

export const RemoteCommandSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 80, pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]*$" }),
  command: Type.String({ minLength: 1 }),
  idempotent: Type.Boolean(),
}, { additionalProperties: false });
export type RemoteCommand = Static<typeof RemoteCommandSchema>;

export const RemoteExperimentSchema = Type.Object({
  schemaVersion: Type.Literal(REMOTE_EXPERIMENT_SCHEMA_VERSION),
  id: Type.String({ minLength: 1, maxLength: 120, pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$" }),
  deviceId: Type.String({ minLength: 1, maxLength: 120, pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]*$" }),
  user: Type.String({ minLength: 1 }),
  workdir: Type.String({ minLength: 1 }),
  allowedCommandPatterns: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  commands: Type.Array(RemoteCommandSchema, { minItems: 1 }),
  commandTimeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 3600 })),
  taskTimeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 86400 })),
  maxRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })),
  maxConcurrentDevices: Type.Optional(Type.Literal(1)),
  cleanup: Type.Array(Type.String()),
  resourceLimits: Type.Object({
    cpu: Type.Optional(Type.String()),
    memory: Type.Optional(Type.String()),
    disk: Type.Optional(Type.String()),
    gpu: Type.Optional(Type.String()),
  }, { additionalProperties: false }),
}, { additionalProperties: false });
export type RemoteExperiment = Static<typeof RemoteExperimentSchema>;

export const RemoteCommandRecordSchema = Type.Object({
  commandId: Type.String(),
  deviceId: Type.String(),
  user: Type.String(),
  workdir: Type.String(),
  commandSummary: Type.String(),
  startedAt: Type.String({ format: "date-time" }),
  endedAt: Type.String({ format: "date-time" }),
  durationMs: Type.Integer({ minimum: 0 }),
  exitCode: Type.Union([Type.Integer(), Type.Null()]),
  stdoutPath: Type.Optional(Type.String()),
  stderrPath: Type.Optional(Type.String()),
  resourceUsage: Type.Optional(Type.Record(Type.String(), Type.String())),
  outcome: StringEnum(["succeeded", "failed", "timed_out", "cancelled", "needs_review"] as const),
  attempts: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });
export type RemoteCommandRecord = Static<typeof RemoteCommandRecordSchema>;

export const RemoteExperimentResultSchema = Type.Object({
  status: StringEnum(["succeeded", "failed", "blocked", "needs_review", "cancelled"] as const),
  records: Type.Array(RemoteCommandRecordSchema),
  cleanup: Type.Array(Type.String()),
  escalation: Type.Optional(Type.Object({
    reason: Type.String(),
    summary: Type.String(),
    attempted: Type.Array(Type.String()),
    evidence: Type.Array(Type.Object({ claim: Type.String(), source: Type.String() }, { additionalProperties: false })),
    question: Type.String(),
  }, { additionalProperties: false })),
}, { additionalProperties: false });
export type RemoteExperimentResult = Static<typeof RemoteExperimentResultSchema>;

export const RemoteExperimentCheckpointSchema = Type.Object({
  schemaVersion: Type.Literal(REMOTE_EXPERIMENT_SCHEMA_VERSION),
  revision: Type.Integer({ minimum: 0 }),
  experiment: RemoteExperimentSchema,
  status: StringEnum(["running", "succeeded", "failed", "blocked", "needs_review", "cancelled"] as const),
  startedAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" }),
  nextCommandIndex: Type.Integer({ minimum: 0 }),
  activeCommand: Type.Optional(Type.Object({
    id: Type.String(),
    idempotent: Type.Boolean(),
  }, { additionalProperties: false })),
  records: Type.Array(RemoteCommandRecordSchema),
  escalation: Type.Optional(Type.Object({
    reason: Type.String(),
    summary: Type.String(),
    attempted: Type.Array(Type.String()),
    evidence: Type.Array(Type.Object({ claim: Type.String(), source: Type.String() }, { additionalProperties: false })),
    question: Type.String(),
  }, { additionalProperties: false })),
}, { additionalProperties: false });
export type RemoteExperimentCheckpoint = Static<typeof RemoteExperimentCheckpointSchema>;
