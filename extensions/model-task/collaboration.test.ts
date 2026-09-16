import assert from "node:assert/strict";
import test from "node:test";
import { MODEL_TASK_SCHEMA_VERSION, type TaskResult, type TaskSpec } from "./schemas.ts";
import { escalationReasons, minimalEscalationRequest, requiresMandatoryReview } from "./collaboration.ts";

function task(goal = "Make a change"): TaskSpec {
  return {
    schemaVersion: MODEL_TASK_SCHEMA_VERSION,
    id: "collaboration",
    goal,
    context: ["token=do-not-send"],
    constraints: ["No extra permissions"],
    scope: { cwd: "/repo", includePaths: ["src"], excludePaths: [".env"] },
    acceptanceCriteria: ["Tests pass"],
    escalationRules: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function result(overrides: Partial<TaskResult> = {}): TaskResult {
  return { summary: "done", models: [], changes: [], verification: [], risks: [], unresolved: [], nextActions: [], ...overrides };
}

test("hard escalation rules detect architecture, API, data, security, permission and remote risk", () => {
  const reasons = escalationReasons(task("Change public API architecture and data format with security permission risk on production remote"), "succeeded", result());
  assert.deepEqual(reasons, ["architecture_change", "api_change", "data_format_change", "security_risk", "permission_risk", "remote_high_risk"]);
  assert.equal(requiresMandatoryReview(task("Change public API"), result()), true);
});

test("minimal escalation request redacts secrets and excludes transcript-like context", () => {
  const spec = task("Fix token=top-secret");
  const request = minimalEscalationRequest(spec, "needs_review", result({ unresolved: ["Authorization: Bearer hidden"] }), ["acceptance_unmet"]);
  const serialized = JSON.stringify(request);
  assert.equal(serialized.includes("top-secret"), false);
  assert.equal(serialized.includes("hidden"), false);
  assert.equal(serialized.includes("do-not-send"), false);
  assert.equal("context" in request, false);
});
