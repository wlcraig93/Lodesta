import assert from "node:assert/strict";
import { ownerFacingError } from "../lib/owner-errors";

// Owners never see internal codes, run IDs or raw exception text.
const originalError = console.error;
console.error = () => undefined;
try {
  for (const raw of [
    "concurrent_project_limit",
    "Session already has an active run: run_0123456789abcdef",
    "candidate_integrity_failed:route.response,render.console",
    "stale_control_plane_change",
    "TypeError: Cannot read properties of undefined (reading 'id')"
  ]) {
    const mapped = ownerFacingError(new Error(raw), "verify");
    assert(!/run_[0-9a-f]|_[a-z]+_|TypeError|undefined|:/.test(mapped.error), `Owner saw internal detail for ${raw}: ${mapped.error}`);
    assert(mapped.error.endsWith("."), mapped.error);
  }
  assert.equal(ownerFacingError(new Error("A phone or email value is required."), "verify").error, "Enter a phone number or email address.");
  assert.equal(ownerFacingError(new Error("boom"), "verify", "Custom fallback.").error, "Custom fallback.");
} finally {
  console.error = originalError;
}
console.log(JSON.stringify({ ok: true, ownerErrors: "plain-language" }));
