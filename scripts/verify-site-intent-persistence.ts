import assert from "node:assert/strict";
import { persistSiteIntentAuthority } from "../packages/platform-data/repository";
import type { SiteIntentV3 } from "../packages/site-contracts";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

const initial = buildSyntheticSiteInput().intent;
const inserted = mockClient({ current: null });
await persistSiteIntentAuthority(inserted.client as never, initial);
assert.equal(inserted.calls.insert?.created_at, initial.updatedAt, "initial intent omitted its non-null creation timestamp");
assert.equal(inserted.calls.insert?.updated_at, initial.updatedAt, "initial intent omitted its update timestamp");
assert.equal(inserted.calls.update, undefined, "initial intent used the update path");

const next = {
  ...initial,
  revision: initial.revision + 1,
  intentHash: `sha256:${"7".repeat(64)}`,
  updatedAt: "2026-07-22T18:00:00.000Z"
} satisfies SiteIntentV3;
const updated = mockClient({ current: initial, updateResult: { site_id: initial.siteId } });
await persistSiteIntentAuthority(updated.client as never, next);
assert(updated.calls.update, "existing intent did not use the update path");
assert(!Object.hasOwn(updated.calls.update, "created_at"), "intent update attempted to overwrite created_at");
assert.deepEqual(updated.calls.filters, [["site_id", initial.siteId], ["revision", initial.revision]], "intent update was not revision-guarded");
assert.equal(updated.calls.insert, undefined, "existing intent used the insert path");

const conflicted = mockClient({ current: initial, updateResult: null });
await assert.rejects(
  persistSiteIntentAuthority(conflicted.client as never, next),
  /site_intent_revision_conflict/,
  "zero-row optimistic update did not fail as a revision conflict"
);

process.stdout.write(`${JSON.stringify({
  ok: true,
  insertCreationTimestamp: "pass",
  updateExcludesCreatedAt: "pass",
  optimisticRevisionConflict: "pass"
})}\n`);

function mockClient(input: { current: SiteIntentV3 | null; updateResult?: { site_id: string } | null }) {
  const calls: {
    insert?: Record<string, unknown>;
    update?: Record<string, unknown>;
    filters: Array<[string, unknown]>;
  } = { filters: [] };
  const client = {
    from(table: string) {
      assert.equal(table, "site_intents_v3");
      let operation: "read" | "insert" | "update" = "read";
      const query = {
        select(_columns: string) { return query; },
        eq(column: string, value: unknown) {
          if (operation === "update") calls.filters.push([column, value]);
          return query;
        },
        insert(payload: Record<string, unknown>) {
          operation = "insert";
          calls.insert = payload;
          return query;
        },
        update(payload: Record<string, unknown>) {
          operation = "update";
          calls.update = payload;
          return query;
        },
        maybeSingle() {
          const data = operation === "read"
            ? input.current ? { intent: input.current } : null
            : input.updateResult ?? null;
          return Promise.resolve({ data, error: null });
        },
        then(resolve: (value: { data: null; error: null }) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        }
      };
      return query;
    }
  };
  return { client, calls };
}
