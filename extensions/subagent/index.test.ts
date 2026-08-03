import assert from "node:assert/strict";
import test from "node:test";
import { isSubagentEnabled } from "./index.ts";

test("subagent capability is default-off and requires explicit opt-in", () => {
  assert.equal(isSubagentEnabled({}), false);
  assert.equal(isSubagentEnabled({ OH_MY_PI_SUBAGENT_ENABLED: "0" }), false);
  assert.equal(isSubagentEnabled({ OH_MY_PI_SUBAGENT_ENABLED: "1" }), true);
});
