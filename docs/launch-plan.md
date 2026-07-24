# Lodesta Pre-Launch Rollout

**Status:** Canonical account-owned builder implemented; development cutover completed and each additional environment remains manifest-gated

## Product contract

- A configured Supabase account is the only identity requirement for project creation.
- Any signed-in user may import any public source URL. Source URLs are reusable and never confer ownership.
- Same-account duplicate detection is advisory and requires an explicit confirmation; it never queries or discloses another account.
- Every project owns a unique Lodesta slug and may publish there after objective release checks.
- `sites.owner_user_id` is the sole owner authorization source.
- Custom hostnames are exclusive only after exact, site-bound TXT proof. The owner configures the ownership TXT record and routing CNAME/ALIAS together.
- Billing is not part of this release.
- Every retained image carries a typed origin (`source_website`, `owner_upload`, or `platform_generated`) and immutable provenance; media rights are not represented as a separate approval workflow.

## Verification before infrastructure work

```bash
npm run typecheck
npm run verify:architecture
npm run verify:database
npm run verify:authoring
npm run verify:runtime
npm run verify:account-setup-domain
npm run verify:acquisition
npm run verify:render-browser
npm run smoke:dev
```

## Canonical reset

The repository intentionally contains one from-zero canonical baseline followed by reviewed forward migrations. Never apply the baseline over a historical public schema.

1. Finish and review the coordinated code/schema change.
2. Quiesce web and workers.
3. Create an annotated pre-reset Git tag and retain runnable web, worker, and sandbox artifacts with exact image digests.
4. Snapshot the public schema, migration ledger, row counts, referenced blobs, blob hashes, and a manifest hash.
5. Restore that snapshot into an isolated Supabase environment and verify rows, `auth.users` foreign keys, blobs, and hashes.
6. Apply the canonical migration chain from zero in a separate empty Supabase environment and run the full suite with `LODESTA_VERIFY_LIVE_DATABASE=true`.
7. Require the exact operator confirmation `reset-prelaunch:<manifest-hash>`.
8. Preserve Supabase Auth, reset only application-owned public schema and managed artifact storage, and apply the canonical migration chain.
9. Seed the trusted runtime and operator defaults.
10. Deploy web and worker together, then run live boundary verification before reopening traffic.

The implementation workflow must stop before step 8 unless the exact manifest-bound confirmation has been supplied.

## Rollback

If live boundary verification fails:

1. Quiesce the new stack.
2. Redeploy the tagged pre-reset web, worker, and sandbox artifacts.
3. Restore the rehearsed database and blob snapshot.
4. Run the prior stack’s verification before reopening traffic.

No experimental sites, telemetry, claims, billing rows, or test projects are restored into the new canonical schema.
