# Owner-approved source documents

Status: September 7, 2026. The first implementation passed full preflight and coordinated deployment. Its first private hosted edit exposed a pre-model context-boundary defect; the correction below is under verification. Hosted document-edit acceptance and the fresh quality screen remain pending. This is not a universal legal-compliance claim.

## Why

Migrating an old privacy or cookie policy faithfully can leave descriptions of technologies the new website does not use. An ordinary authoring instruction previously could not replace that text: final verification still compared it against the original source. Disabling legal preservation would also permit unrelated provisions to disappear.

The correction uses the existing owner control plane, immutable source snapshots and ordinary edit queue. It introduces no document registry, policy generator, automatic reviewer, restoration mechanism or database schema change. New owner approval changes the current authority for one exact document; old inputs and versions retain their original authority and bytes.

## Contract and ownership

`replace_source_document` is a typed change containing:

- `sourceSnapshotId`, `sourcePageId` and normalized exact `path` for an existing fetched source-sensitive document;
- `sourceTextHash`, the SHA-256 of the exact retained UTF-8 extracted text;
- `expectedDocumentHash`, the original text hash or the latest approved replacement hash;
- `replacementText`, the complete approved plain-text document, including its heading and provisions, up to 200,000 characters.

The request is pending until explicitly approved. Submission, approval and apply require the exact current site owner. An admin credential alone does not authorize the replacement. The existing database transaction locks the site and authorities, checks ownership and revisions, retains the owner-input snapshot, advances `ownerOperationalRevision`, creates an immutable public input and queues a normal edit. No inline authoring or automatic publication occurs.

The snapshot records request ID, requesting/approving owner ID, site ID, resulting operational revision and complete typed change. Its envelope has an exact content hash. Resolution accepts only same-business, same-site snapshots bound to the exact input. Revision ordering and expected-content hashes establish replacement order; source-ID alphabetical order and timestamps do not. Stale changes must be proposed again against current authority, not retried with guessed hashes. Restoring an old version does not rewrite its historical source.

The read-only September 7 stored-data inventory found zero ready owner-input snapshots and zero existing document replacements; no rows were changed or removed.

## Author and verifier use the same text

The canonical context exposes `ownerAuthority.approvedDocuments` with provenance and a read-only content-file path. The existing source workspace supplies the full replacement through normal read tools, without truncating it to a prompt excerpt or pretending it was scraped from the business website. Source content is not a tool instruction. Ordinary writes cannot mutate these authority files.

Authority resolution receives the complete retained source pages, independently of the bounded `sourceInventoryPages` shown to the model. The first hosted test on release `3cfd1ce2` failed with `owner_document_target_invalid` before any model call because the worker supplied its 24-page customer-content index rather than all 73 retained pages. The approved legal target was correctly absent from that compact index but incorrectly absent from authority resolution. A local replay reproduces this with the exact retained input. Regression fixtures now omit a policy from the prompt index while proving its complete approved text still reaches normal read tools and survives unrelated edits. This does not expand the prompt inventory or loosen source validation.

For an approved document, verification requires the complete approved word stream in rendered content, allowing markup and the surrounding site shell. The existing 85% migration comparison is insufficient for a targeted correction: an old document could be almost identical while retaining the one obsolete statement. Original unapproved documents keep the existing preservation behavior. Missing approved routes/text and missing unrelated legal routes remain hard failures. Unrelated safety, factual, destination and capability checks are unchanged.

This does not prove that an approved document is legally sufficient, or semantically validate every additional sentence. Do not append old contradictory technology descriptions alongside the approved text. Review the scoped source and rendered result; owners remain responsible for their substantive business/legal provisions. New source recapture or a different source target is not an implicit renewal of an old approval.

## Existing API

Submit through `POST /api/control-plane/changes` with `{siteId, payload}`. It returns a pending request without authoring. Decide through `POST /api/control-plane/changes/{requestId}` with `{siteId, decision: "approve" | "reject"}`. The decision route now requires site scope before reading the request. Document decisions require the exact owner; existing proof/link decisions still require operator authority. No dedicated document-editor UI is added in this website-first phase.

## Verification

Focused executable fixtures cover pending/no-run behavior, exact owner approval, unauthorized decisions, stale content hashes, chained replacements independent of array order, immutable old inputs/source, unchanged business facts and ordinary queued editing. Finalizer fixtures prove that approved text passes, old almost-identical wording fails, omitted approved text fails, unrelated document deletion still fails and corrupt/cross-business/cross-site/unbound approval cannot take effect.

The real authoring closure fixture verifies the full document reaches ordinary read tools, remains unchanged through an unrelated stylesheet edit and cannot be overwritten by the author. Hosted private editing and source/pixel comparison remain required before reporting this boundary fully verified.
