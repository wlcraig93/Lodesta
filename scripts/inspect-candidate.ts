/**
 * One-off candidate inspector. Dumps a structured summary of a stored site
 * candidate so we can assess generation quality.
 *
 *   node --import tsx --import ./scripts/load-env.ts scripts/inspect-candidate.ts <candidateId>
 */
import { supabaseRepository } from "../lib/supabase/repository";
import type { SiteVersionV3 } from "../lib/models";

function line(label: string, value: unknown) {
  console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("usage: inspect-candidate.ts <candidateId>");

  const candidate = await supabaseRepository.getSiteCandidate(id);
  if (!candidate) {
    console.log(`No candidate found for ${id}`);
    return;
  }

  const bundle = candidate.bundle;
  const biz = bundle.businessProfile;
  const versions = bundle.siteModel.versions;
  const version = (versions.find((v) => v.status === "draft") ?? versions[0]) as SiteVersionV3 | undefined;

  console.log("==================== CANDIDATE ====================");
  line("id", candidate.id);
  line("businessName", candidate.businessName);
  line("vertical", candidate.vertical);
  line("status", candidate.status);
  line("candidatePurpose", candidate.candidatePurpose);
  line("candidateSlug", candidate.candidateSlug);
  line("sourceUrl", candidate.sourceUrl);
  line("sourceHost", candidate.sourceHost);
  line("createdAt", candidate.createdAt);
  line("updatedAt", candidate.updatedAt);

  console.log("\n==================== BUSINESS PROFILE ====================");
  line("name", biz.name);
  line("vertical", (biz as Record<string, unknown>).vertical);
  line("phone", (biz as Record<string, unknown>).phone);
  line("email", (biz as Record<string, unknown>).email);
  line("address", JSON.stringify((biz as Record<string, unknown>).address ?? (biz as Record<string, unknown>).locations));
  line("services", JSON.stringify((biz as Record<string, unknown>).services));
  line("tagline", (biz as Record<string, unknown>).tagline);
  line("description", (biz as Record<string, unknown>).description);

  console.log("\n==================== VERSIONS ====================");
  line("versionCount", versions.length);
  for (const v of versions) {
    console.log(`  - ${v.id} status=${v.status} renderer=${(v as Record<string, unknown>).rendererVersion} schema=${(v as Record<string, unknown>).designSchemaVersion}`);
  }

  if (!version) {
    console.log("\nNo version to inspect.");
    return;
  }

  console.log("\n==================== ART DIRECTION ====================");
  console.log(JSON.stringify((version as Record<string, unknown>).artDirection, null, 2));

  console.log("\n==================== GENERATION QA ====================");
  const qa = (version as Record<string, unknown>).generationQa as Record<string, unknown> | undefined;
  if (qa) {
    line("readiness", qa.readiness);
    line("hasPrimaryScreenshot", Boolean(qa.primaryScreenshot));
    const blockers = (qa.blockers ?? qa.issues ?? []) as unknown[];
    line("blockerCount", Array.isArray(blockers) ? blockers.length : 0);
    console.log("blockers/issues:", JSON.stringify(blockers, null, 2));
    if (qa.legacy) console.log("legacy:", JSON.stringify(qa.legacy, null, 2));
  } else {
    console.log("(no generationQa)");
  }

  console.log("\n==================== PAGE COMPOSITION ====================");
  const composition = (version as Record<string, unknown>).pageComposition as Record<string, unknown> | undefined;
  const pages = (composition?.pages ?? []) as Array<Record<string, unknown>>;
  line("pageCount", pages.length);
  for (const page of pages) {
    const sections = (page.sections ?? []) as Array<Record<string, unknown>>;
    console.log(`\n  PAGE: ${page.slug ?? page.id} (${page.title ?? "untitled"}) — ${sections.length} sections`);
    for (const s of sections) {
      console.log(`    · ${s.family ?? s.type ?? "?"}  variant=${s.variant ?? "?"}  id=${s.id ?? ""}`);
    }
  }

  console.log("\n==================== MEDIA DECISIONS ====================");
  const media = ((version as Record<string, unknown>).mediaDecisions ?? []) as Array<Record<string, unknown>>;
  line("mediaCount", media.length);
  for (const m of media) {
    console.log(`    · slot=${m.slotId ?? m.slot ?? "?"} source=${m.source ?? "?"} rights=${m.rightsStatus ?? "?"} ${m.assetId ?? m.url ?? ""}`);
  }

  console.log("\n==================== CANONICAL SITE COPY ====================");
  const presence = (bundle as Record<string, unknown>).presenceAssessment as Record<string, unknown> | undefined;
  const copy = presence?.siteCopy;
  if (copy) {
    console.log(JSON.stringify(copy, null, 2).slice(0, 6000));
  } else {
    console.log("(copy not stored separately; embedded in section slots — dumping first page sections raw)");
    const firstPage = pages[0];
    if (firstPage) console.log(JSON.stringify(firstPage, null, 2).slice(0, 8000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
