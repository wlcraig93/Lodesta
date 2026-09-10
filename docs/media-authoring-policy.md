# Media authoring policy

Lodesta is operating in a pre-launch proving phase. The website author should choose the media that produces the strongest truthful website; retained source media is available, not mandatory.

## Canonical origin

Every immutable asset revision and business-state asset reference has one origin:

- `source_website`: discovered on a page crawled from the business website. The file itself may be served by a CDN or image host; the crawled business page establishes its origin.
- `owner_upload`: supplied directly by the authenticated owner or an operator acting through the owner-media workflow.
- `platform_generated`: created or edited through Lodesta’s image-generation tool.

There is no owner attestation, rights status, media approval state, preview-only media classification, or media-specific publication blocker. External research pages can provide evidence and context but never contribute ingestible media.

## Source media ingestion

The crawler ranks source-site media by useful source description, role, page placement, dimensions, and resolution. It removes exact duplicates and visually near-identical candidates with a perceptual image hash, then retains at most 24 useful files across crawled business-site pages. Each retained file must:

- resolve through the public-fetch safety boundary;
- decode successfully as PNG, JPEG, or WebP;
- remain within the byte and pixel limits;
- have non-zero decoded dimensions; and
- be stored as an immutable, business-scoped asset revision with its source page and source snapshot.

The canonical initial request includes bounded high-detail source and managed-asset contact sheets. Current limits are eight source candidates and two managed assets; these sheets are a starting sample, not exhaustive visual inspection. Managed asset IDs are immediately usable; source resource IDs require adoption. Canonical semantic-neutral context omits old alt text and filename/page cues from the relevant previews rather than presenting them as verified image descriptions.

Both sheets label decoded, orientation-correct original dimensions and never enlarge small originals into apparently larger photographs. Selective `inspect_assets` previews expose those original dimensions too, separately from the bounded preview image. Retained dimensions and image bytes are never rewritten by inspection. Authored page layout and cropping remain editable; this adds no crop scorer, image quota, mandatory tool sequence, or presentation gate.

## Generated and edited media

The implemented manager tool `create_image` uses the direct OpenAI Image API with the explicit `gpt-image-2.5-flare` model, high quality, WebP output, and automatic generation moderation. Edit requests omit `input_fidelity`; the tested API handles fidelity without that parameter. Generation takes no source assets; editing takes one to four existing business asset IDs and records their immutable revision IDs in provenance. Returned text-input, image-input, and image-output token usage is priced through the local image-model catalog and contributes to the authoring run's cost fuse; absent or inconsistent usage stops the run with `cost_telemetry_unavailable`. The selected request model, new asset provenance, and metering identity share one constant. Retained `gpt-image-2` provenance remains readable and is never relabeled.

**Canonical availability:** `create_image` is an optional authoring tool alongside source-media inspection and adoption. The obsolete tool-exclusion field and dispatch filter are removed; there is no alternate profile, feature flag, mandatory image-generation step, or model selector. The compact prompt defers media choice to the shared skill: authentic business evidence first, generic supporting imagery only for a useful gap. Owner intent and existing source outside an edit's scope still win. Local implementation and deployment are distinct from proof that this improves a full site; the controlled authoring treatment below must establish that evidence.

Authoring is source-first. Generated supporting imagery is appropriate only when the retained source set cannot fill a useful visual role, and its prompt must specify that role and the needed composition. Prompts should create polished, believable, compositionally useful images without accidental text or logos. Do not generate near-duplicates merely to fill repeated layout slots.

Generation must not fabricate business-specific staff, uniforms, vehicles, facilities, products, equipment ownership, completed jobs, credentials, licensing, insurance, customer outcomes, or other factual claims. Real source media is required for identity-specific subjects. Generated supporting imagery must remain visibly generic to the category or subject and must not imply that a depicted person, property, vehicle, project, or credential belongs to the business.

New image-tool requests cannot use a logo purpose or edit a managed official-logo source, regardless of the requested output purpose. These requests fail before image API access. Existing official-logo source adoption and preparation are unchanged; historical generated-logo provenance remains readable without granting new logo-generation capability.

Generated and adopted bytes are stored immutably, and their provisional revision/reference metadata is saved in the existing fenced run record before the tool returns a usable asset ID. They remain outside canonical business state until the candidate passes the objective verification gate. Verified finalization atomically adopts the generated revisions, the next `BusinessState`, and the exact `SitePublicBuildInput`, updates the run/session input IDs, and stales older candidates. Failed or abandoned runs leave canonical business state unchanged. The existing blob audit protects all image bytes referenced by retained runs, including failed resumable runs; only genuinely unreferenced bytes are cleanup candidates.

Restart rehydrates this metadata only after checking its hash, run/business/site/input/parent scope, unchanged base business state, revision/reference agreement, complete provenance ancestry, and actual blob hashes and lengths. Invalid or missing recovery bytes fail before resumed authoring rather than silently substituting a placeholder for the saved media. Same-run form changes rebind the recovery input in the existing atomic form transaction. Model/producer/execution metadata describes the saved draft; a new claimed execution may resume it without recreating images. There is no new table, media registry, authoring step or automatic image retry. A successful paid image request whose persistence fails still returns metering, but not a usable asset ID.

When a selected generated edit depends on another provisional image, retain its complete provisional source-revision ancestry at finalization. Provenance-only ancestors belong in the immutable input's existing `assetRevisionIds` retention manifest, not the current business asset library or rendered page. The existing input-to-asset references protect their rows and bytes. Missing ancestry or a cycle fails integrity validation instead of persisting a dangling provenance chain. This is artifact retention inside existing finalization, not an authoring step or a new database schema.

## September 10 image evidence and decision

Nine private requests compared Image 2, Image 2.5 Flare, and Image 2.5 Sunburst: two generic supporting photographs and one lighting-only edit per model, with identical prompts/settings and a common edit input. All used high quality, 1536×1024 WebP, and no client retries. Estimated cost from returned token usage totaled $0.782914. This is one observation per model/case, not a reliability or full-site quality evaluation.

| Model | Three-case estimated cost | Observed latency per request |
| --- | --- | --- |
| Image 2 | $0.507898 | 91–125 seconds |
| Image 2.5 Flare | $0.137508 | 14–19 seconds |
| Image 2.5 Sunburst | $0.137508 | 25–39 seconds |

Blind review found no obvious realism failures, fabricated business proof, or material geometry changes in the lighting edits. Image 2's canopy had the strongest reserved copy space; the painting and lighting cases were ties. Select Flare for the image tool on the observed cost/latency tradeoff, not a claim that it always produces better composition. Sunburst showed no material visual advantage in this screen. The existing API path decoded all nine responses and recorded usage successfully.

A separate eight-call Luna source-photo description probe cost an estimated $0.00492075. Image-only descriptions of the two previously misdescribed scenes were supported. Adding old description candidates did not demonstrate an improvement and produced one unsupported posture. Keep semantic-neutral visual evidence; do not restore hints or add a mandatory interpretation phase on this evidence. The independent improvements are truthful original dimensions and no thumbnail enlargement, verified with actual source-tool/contact-sheet fixtures.

The read-only retained asset report found 183 asset revisions, all `source_website` with no image-model provenance. No stored rows were changed. This report is limited to the asset-revision table, not a claim that no historical generated media exists anywhere.

Private reproducible inputs, request IDs, usage, images, and blind review are retained under `.design/image-assets-evaluation-2026-09-10/`; its `OUTCOME.md` links the historical source-photo probe. Neither isolated screen created or published a customer site. The owner-approved authoring treatment is recorded under `.design/image-authoring-treatment-2026-09-10/`: deploy the verified integration, run a fresh Luna build using frozen business evidence, inspect every route and compare concrete defects to its retained Luna baseline. Continue to a contrasting business only if the first passes delivery review. Record non-use of generation honestly; do not force an image call to manufacture a positive experiment result. No fixed-screen or broad reliability claim follows from one or two builds.

The integration was deployed in `bb1397a86125f1b5b9f7df39cf1d658e33920d04` and the first full-site treatment completed as `version_b0ebfae1796b1e56c3519a692055acaa` for $0.34109642 estimated. It used no generated image and added two authentic source photos, but failed delivery review: empty article bodies, responsive layout defects, and a 300px source photo enlarged to 760px. Stop before the contrasting case. Correct dimensions and optional image generation do not themselves guarantee good image placement or complete site authoring. The [current status](generated-site-authoring-status.md) and private treatment review preserve that failure separately from subsequent assisted repair.

Corrective release `10bab2d3863228c8784282210dbf79d4c3d07115` and two ordinary Luna edits produced final private candidate `version_28f1a914170edc6568fd5dc4a2fa9ead`. Scoped source/visual review accepts the repaired content, layouts and photo placement, preserving all nine asset revisions and protected authority. Neither edit generated or adopted media. Thus this is evidence of ordinary editing capability, not fresh-build acceptance or proof that Image 2.5 improves a site.

The initial interruption characterization found that provisional metadata was held only in a worker closure, and a synthetic finalizer test with an unknown asset produced a safe placeholder while passing the gate. The subsequent durable run-metadata correction above addresses that loss path; it does not change general unknown-asset finalization policy or retroactively repair historical runs. Local workflow interruption tests and hosted verification must be recorded separately. See private `PROVISIONAL_MEDIA_RECOVERY.md` for the original failure and `recovery-validation/` for the correction's evidence and deployment status.
