import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { LocalSitePlatformRepository } from "../packages/platform-data/repository";
import { LocalArtifactBlobStore } from "../packages/site-artifacts";
import { SiteAuthoringWorkflow } from "../packages/site-platform/workflow";
import { createSiteAuthoringContext, siteAgentRunGuardrailsForKind, type WebsiteManagerAgent } from "../packages/site-agent";
import { businessStateSchema, siteAgentRunSchema, siteAgentSessionSchema, type SitePublicBuildInput } from "../packages/site-contracts";
import { sha256, stableJson } from "../packages/business-data";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

// Exercise the actual workflow closure and local transactional repository. No
// model/network calls, no replacement implementation of form/media behavior.
const directory = await mkdtemp(join(tmpdir(), "lodesta-form-media-"));
try {
  const repository = new LocalSitePlatformRepository(join(directory, "repository.json"));
  const store = new LocalArtifactBlobStore(join(directory, "blobs"));
  const input = buildSyntheticSiteInput();
  const now = new Date().toISOString();
  const owner = "58c3a17e-6ad5-4e2c-9eb3-90e71527a054";
  const stateBody = {
    schemaVersion: 1, businessId: input.businessId, siteId: input.siteId,
    revision: 1, ownerOperationalRevision: 1, updatedAt: now,
    identity: { name: input.business.name, status: input.business.identityStatus, description: input.business.description, categories: [] },
    contacts: input.business.contacts, locations: input.business.locations, serviceAreas: input.business.serviceAreas,
    offerings: input.business.offerings, proof: input.business.proof, assets: input.business.assets,
    links: input.business.links, facts: input.publicFacts
  };
  await repository.createSite({ id: input.siteId, ownerUserId: owner, businessId: input.businessId,
    slug: "form-media-test", status: "draft", reportingTimezone: "UTC", currentPublicBuildInputId: input.id, createdAt: now, updatedAt: now });
  await repository.saveBusinessState(businessStateSchema.parse({ ...stateBody, stateHash: sha256(stableJson(stateBody)) }));
  await repository.saveSiteIntent(input.intent);
  for (const form of input.forms) await repository.saveFormDefinition(form);
  await repository.savePublicBuildInput(input);
  const session = siteAgentSessionSchema.parse({ schemaVersion: "site-agent-session", id: "session_form_media",
    siteId: input.siteId, principal: { kind: "owner", id: owner }, status: "active", publicBuildInputId: input.id,
    sandboxProvider: "cloudflare", sandboxId: "sandbox_form_media", leaseTokenHash: sha256("test-lease"),
    leaseExpiresAt: new Date(Date.now() + 3_600_000).toISOString(), rotateAt: new Date(Date.now() + 7_200_000).toISOString(),
    createdAt: now, updatedAt: now });
  await repository.saveAgentSession(session);
  const run = siteAgentRunSchema.parse({ schemaVersion: "site-agent-run", id: "run_form_media", sessionId: session.id,
    siteId: input.siteId, publicBuildInputId: input.id, request: { kind: "owner_instruction", messageIds: ["message_form_media"] },
    origin: "owner_request", requestedBy: owner, kind: "edit", status: "running", stage: "authoring", executionNumber: 1,
    apiProvider: "openai", modelId: "gpt-5.6-sol", skillVersions: {}, guardrails: siteAgentRunGuardrailsForKind("edit", now),
    usage: { inputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, outputTokens: 0, costUsd: 0, costSource: "unavailable", upstreamInferenceCostUsd: 0, durationMs: 0 }, startedAt: now });
  await repository.saveAgentRun(run);
  const mediaBytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#285649" } }).webp().toBuffer();
  const rebased: SitePublicBuildInput[] = [];
  const sandbox = {
    rebase: async (_id: string, _revision: string, next: SitePublicBuildInput) => {
      rebased.push(next); return { revision: `rebase_${rebased.length}` };
    },
    apply: async () => ({ revision: `build_${rebased.length}`, buildDurationMs: 1, previewPath: "/preview" })
  };
  const complete = new Error("fixture_complete");
  const manager = { run: async ({ runtime }: Parameters<WebsiteManagerAgent["run"]>[0]) => {
    const image = await runtime.execute({ callId: "media", name: "create_image", arguments: {
      action: "generate", purpose: "background", prompt: "Synthetic test texture", sourceAssetIds: [], size: "1024x1024", alt: "Test texture"
    } });
    assert.equal(image.diagnosticOutput.ok, true);
    assert.equal((await runtime.execute({ callId: "build1", name: "build_preview", arguments: {} })).diagnosticOutput.ok, true);
    assert.equal(rebased.length, 1);
    assert.equal(rebased[0]!.business.assets.length, 1);
    const configuration = { ...input.forms[0]!, expectedRevision: 1, submitLabel: "Ask about a repair" };
    const first = await runtime.execute({ callId: "form1", name: "configure_lead_form", arguments: configuration });
    assert.equal(first.diagnosticOutput.ok, true);
    const retainedRun = (await repository.getAgentRun(run.id))!;
    const retained = (await repository.getPublicBuildInput(retainedRun.publicBuildInputId))!;
    assert.equal(retained.forms[0]!.revision, 2);
    assert.equal(retained.business.assets.length, 0, "Uncommitted media must not enter the form transaction.");
    assert.equal(retained.ownerOperationalRevision, input.ownerOperationalRevision);
    assert.equal((await runtime.execute({ callId: "build2", name: "build_preview", arguments: {} })).diagnosticOutput.ok, true);
    assert.equal(rebased.length, 2, "A form change must rebase even when media references are unchanged.");
    assert.notEqual(rebased[1]!.id, rebased[0]!.id);
    assert.equal(rebased[1]!.forms[0]!.revision, 2);
    assert.deepEqual(rebased[1]!.business.assets, rebased[0]!.business.assets);
    const second = await runtime.execute({ callId: "form2", name: "configure_lead_form", arguments: { ...configuration, expectedRevision: 2, submitLabel: "Send repair request" } });
    assert.equal(second.diagnosticOutput.ok, true, "A second form change must use the newly retained authority.");
    assert.equal(second.diagnosticOutput.revision, 3);
    await assert.rejects(() => runtime.execute({ callId: "stale", name: "configure_lead_form", arguments: configuration }), /lead_form_revision_conflict:3/);
    assert.equal((await repository.getPublicBuildInput(input.id))!.forms[0]!.revision, 1, "Original immutable input changed.");
    throw complete;
  } };
  const workflow = new SiteAuthoringWorkflow(repository, store, sandbox as never, manager as never, undefined,
    (async () => ({ bytes: mediaBytes, mimeType: "image/webp", width: 16, height: 16, sourceAssetRevisionIds: [],
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, costSource: "unavailable", upstreamInferenceCostUsd: 0, durationMs: 1 }
    })) as never);
  await assert.rejects(() => Reflect.get(workflow, "runAuthoring").call(workflow, {
    run, session, buildInput: input, authoringContext: createSiteAuthoringContext({ buildInput: input, snapshots: [] }),
    snapshots: [], sourcePages: [], sandboxRevision: "initial", kind: "edit", instruction: "Add a texture and change the form button label.",
    currentFiles: [{ path: "src/site.tsx", content: 'export const siteDefinition = { routes: [{path:"/",element:<main><h1>Home</h1></main>}] };' }, { path: "src/styles.css", content: "body{color:#111}" }]
  }), (error: unknown) => error === complete);
  console.log("Form changes preserve retained authority and provisional media across consecutive builds.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
