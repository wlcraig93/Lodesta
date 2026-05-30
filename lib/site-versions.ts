import type { SiteBundle } from "./models";

export type RestoreVersionToDraftResult =
  | { ok: false; reason: string }
  | { ok: true; bundle: SiteBundle; draftVersionId: string; restoredFromVersionId: string };

export function restoreVersionToDraftBundle(
  bundle: SiteBundle,
  input: { versionId: string; createdAt?: string }
): RestoreVersionToDraftResult {
  const source = bundle.siteModel.versions.find((version) => version.id === input.versionId);
  if (!source) return { ok: false, reason: "Version not found." };

  const createdAt = input.createdAt ?? new Date().toISOString();
  const draft = structuredClone(source);
  draft.id = restoredDraftVersionId(bundle, source.id, createdAt);
  draft.status = "draft";
  draft.createdAt = createdAt;
  draft.theme = structuredClone(source.theme ?? bundle.siteModel.theme);
  bundle.siteModel.versions.unshift(draft);

  return {
    ok: true,
    bundle,
    draftVersionId: draft.id,
    restoredFromVersionId: source.id
  };
}

function restoredDraftVersionId(bundle: SiteBundle, sourceVersionId: string, createdAt: string) {
  const sourceSlug = sourceVersionId.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "version";
  const createdAtSeed = Date.parse(createdAt);
  const base = `version_${bundle.siteModel.slug}_restore_${sourceSlug}_${Number.isFinite(createdAtSeed) ? createdAtSeed : Date.now()}`;
  const existingIds = new Set(bundle.siteModel.versions.map((version) => version.id));
  let candidate = base;
  let counter = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base}_${counter}`;
    counter += 1;
  }
  return candidate;
}
