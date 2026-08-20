import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  canonicalTaskSkillFor,
  canonicalAuthoringProfile,
  canonicalAuthoringProfileId,
  liveAuthoringProfile,
  managerAuthoringProfileIdentity,
  taskSkillFor,
  websiteManagerAuthoringSystemPrompt,
  websiteManagerDiscussionSystemPrompt,
  websiteManagerPromptIdentity
} from "../packages/site-agent";
import { sha256 } from "../packages/business-data";
import {
  r8CompactPromptIdentity,
  r8ControlFixtureHash,
  r8InitialBuildProfile,
  r8InitialBuildSkill,
  r8RuntimeSeriesId
} from "../.design/canonical-authoring-bakeoff/retained-control-profile";

const canonicalSkill = canonicalTaskSkillFor("initial_build");
const canonicalProfile = canonicalAuthoringProfile("initial_build");

assert.equal(canonicalAuthoringProfileId, "canonical");
assert.equal(canonicalSkill.identity, taskSkillFor("initial_build").identity);
assert.equal(canonicalSkill.knowledge.length, 8, "The canonical skill must remain compact.");
assert.equal(taskSkillFor("edit").knowledge.length, 4);
assert.equal(taskSkillFor("rebase").knowledge.length, 4);
assert.equal(new Set([
  taskSkillFor("initial_build").identity,
  taskSkillFor("edit").identity,
  taskSkillFor("rebase").identity
]).size, 3);
assert.equal(canonicalProfile.profileId, canonicalAuthoringProfileId);
assert.equal(canonicalProfile.taskSkill.identity, canonicalSkill.identity);
assert.equal(canonicalProfile.systemPrompt, "compact-full-site-pull-source");
assert.equal(canonicalProfile.architectureMode, "commercial-core-pull");
assert.equal(canonicalProfile.architectureEvidenceMode, "indexed-pull-preview-readable");
assert.equal(canonicalProfile.architectureBrowserCoverage, "all-page-types");
assert.equal(canonicalProfile.sourceEvidenceLimit, 4);
assert.equal(canonicalProfile.sourceEvidencePresentation, "contact-sheet");
assert.equal(canonicalProfile.assetEvidenceLimit, 2);
assert.equal(canonicalProfile.assetEvidencePresentation, "contact-sheet");
assert.equal(canonicalProfile.sourceInventoryMode, "representative-customer-index");
assert.deepEqual(canonicalProfile.disabledTools, ["create_image"]);
assert.match(canonicalSkill.knowledge.join(" "), /exact official logo/i);
assert.match(canonicalSkill.knowledge.join(" "), /NavigationDisclosure behavior="modal"/i);
assert.equal(websiteManagerPromptIdentity, `website-manager@${sha256(websiteManagerAuthoringSystemPrompt)}`);
assert(websiteManagerDiscussionSystemPrompt.length < websiteManagerAuthoringSystemPrompt.length / 2);
assert.match(managerAuthoringProfileIdentity(canonicalProfile), /^manager-authoring-profile@sha256:[a-f0-9]{64}$/);
assert.equal(liveAuthoringProfile(canonicalAuthoringProfileId, "initial_build").profileId, canonicalAuthoringProfileId);
assert.throws(
  () => liveAuthoringProfile("retired-profile", "initial_build"),
  /retired_authoring_profile:retired-profile/
);

const [workflowSource, canaryRoute, createForm] = await Promise.all([
  readFile(new URL("../packages/site-platform/workflow.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/site-authoring-canaries/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../components/admin/CreateSiteForm.tsx", import.meta.url), "utf8")
]);

assert.equal(r8InitialBuildSkill.identity, "website-authoring@sha256:35aca099645fc40fc50d0a9c5ef136eee30debc8eb9d3724cd5b504244d25a57");
assert.equal(r8InitialBuildSkill.knowledge.length, 8);
assert.equal(r8InitialBuildProfile.taskSkill, r8InitialBuildSkill);
assert.equal(r8CompactPromptIdentity, websiteManagerPromptIdentity);
assert.equal(r8RuntimeSeriesId, "site-runtime-v2");
assert.equal(r8ControlFixtureHash, "sha256:9a5047805b983b4b303dd4fca4ac2b5da48743a254a9fbd81cc498f219975c31");

assert.match(workflowSource, /const authoringProfileId = canonicalAuthoringProfileId/);
assert.match(workflowSource, /liveAuthoringProfile\(run\.authoringProfileId, run\.kind\)/);
assert.doesNotMatch(workflowSource, /r8InitialBuildProfile|r8-control-profile/);
assert.doesNotMatch(workflowSource, /operatorCompositionReferences/);
assert.match(canaryRoute, /requireAdmin\(request\)/);
assert.match(canaryRoute, /bootstrapFromRetainedSite/);
assert.match(canaryRoute, /generator: "canonical"/);
assert.doesNotMatch(canaryRoute, /identity-nav-copy|feedback-homepage|parsed\.data\.baseline/);
assert.match(createForm, /runs the canonical generator/i);
assert.doesNotMatch(createForm, /name="baseline"|identity-nav-copy|feedback-homepage/);
assert.match(createForm, /name="model" defaultValue="luna"/);

process.stdout.write(`${JSON.stringify({
  ok: true,
  profileId: canonicalAuthoringProfileId,
  skillIdentity: canonicalSkill.identity,
  runtimeSeriesId: "site-runtime-v2"
})}\n`);
