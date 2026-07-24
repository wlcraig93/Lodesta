import { access, readFile } from "node:fs/promises";
import sharp from "sharp";
import { resolveOwnerIdentity, sanitizeDisplayName } from "@/lib/owner-identity";
import { deriveOwnerSiteLifecycle } from "@/lib/owner-site-lifecycle";
import { createArtifactThumbnail } from "@/packages/site-verification/thumbnail";

const identity = resolveOwnerIdentity({
  email: "owner.name@example.com",
  user_metadata: { display_name: "  Owner\u0000   Name  " }
});
assert(identity.displayName === "Owner Name", "Owner display names are not normalized at read time.");
assert(identity.email === "owner.name@example.com", "Owner email is not retained for the account detail surface.");
assert(resolveOwnerIdentity({ email: "owner.name@example.com" }).displayName === "Owner Name", "Email fallback is not humanized.");
assert(sanitizeDisplayName("x") === undefined, "Single-character display names are accepted.");
assert(Array.from(sanitizeDisplayName("a".repeat(100)) ?? "").length === 80, "Display names are not clamped to 80 characters.");

const baseSite = { publishedVersionId: undefined };
const liveSite = { publishedVersionId: "published-version" };
const published = [{ id: "published-version", number: 1, status: "published" as const }];
const candidate = { id: "candidate-version", number: 2, status: "candidate" as const };

assert(deriveOwnerSiteLifecycle({
  slug: "sample",
  site: liveSite,
  versions: published,
  runs: [{ kind: "edit", status: "running", stage: "authoring", inputQuestion: undefined, retryableByOwner: false }]
}).state === "update_in_progress", "A live site with an active run does not resolve to update_in_progress.");

assert(deriveOwnerSiteLifecycle({
  slug: "sample",
  site: liveSite,
  versions: [candidate, ...published],
  runs: [],
  readiness: { status: "blocked", blockers: [{ code: "objective_qa", message: "Review required." }] }
}).state === "needs_attention", "A blocked candidate does not outrank the published lifecycle.");

assert(deriveOwnerSiteLifecycle({
  slug: "sample",
  site: baseSite,
  versions: [candidate],
  runs: [],
  readiness: { status: "ready", blockers: [] }
}).state === "ready_to_publish", "A verified candidate does not resolve to ready_to_publish.");

assert(deriveOwnerSiteLifecycle({
  slug: "sample",
  site: liveSite,
  versions: published,
  runs: [],
  attention: { replyInquiries: 2 }
}).nextAction.href === "/workspace/sample/leads", "Lead attention does not resolve to the canonical Leads route.");

const source = await sharp({
  create: {
    width: 1440,
    height: 2200,
    channels: 3,
    background: { r: 26, g: 88, b: 53 }
  }
}).png().toBuffer();
const thumbnail = await createArtifactThumbnail([
  { key: "capture.png", route: "/", viewport: "desktop", bytes: source }
], "site-captures/site-1/artifact-1");
assert(thumbnail?.key === "site-captures/site-1/artifact-1/thumbnail.webp", "Thumbnail storage key is not canonical.");
const metadata = thumbnail ? await sharp(thumbnail.bytes).metadata() : undefined;
assert(metadata?.format === "webp" && metadata.width === 640 && metadata.height === 400, "Thumbnail output is not a 640×400 WebP.");

const [tokens, shell, account, removeWebsite, thumbnailRoute] = await Promise.all([
  readFile("app/product-tokens.css", "utf8"),
  readFile("components/ProductAppShell.tsx", "utf8"),
  readFile("components/AccountWebsiteCard.tsx", "utf8"),
  readFile("components/RemoveWebsiteButton.tsx", "utf8"),
  readFile("app/api/sites/[siteId]/thumbnail/route.ts", "utf8")
]);
for (const token of ["#f7f8f6", "#fbfcfa", "#f1f3f0", "#dfe4de", "#e7efea", "#68736b"]) {
  assert(tokens.includes(token), `Product token palette is missing ${token}.`);
}
for (const route of ["/editor", "/leads", "/analytics", "/business-details"]) {
  assert(shell.includes(route), `Product navigation is missing ${route}.`);
}
assert(account.includes("aspect-ratio") === false, "Account cards contain inline visual styling instead of product CSS.");
assert(account.includes("querySelector('[role=\"dialog\"]')"), "The website card closes its More menu while the removal dialog handles Escape.");
assert(!account.includes("onOpen=") && removeWebsite.includes("setOpen(true)"), "Opening website removal unmounts its own confirmation dialog.");
assert(thumbnailRoute.includes("site.ownerUserId !== auth.user.id"), "Thumbnail endpoint does not enforce exact owner user-ID equality.");
assert(thumbnailRoute.includes("active && published"), "Thumbnail endpoint does not prefer published imagery while a live update is running.");

for (const path of [
  "app/(owner-workspace)/workspace/[slug]/editor/page.tsx",
  "app/(owner-workspace)/workspace/[slug]/leads/page.tsx",
  "app/(owner-workspace)/workspace/[slug]/analytics/page.tsx",
  "app/(owner-workspace)/workspace/[slug]/business-details/page.tsx"
]) await access(path);

console.log("Product UI verification passed.");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
