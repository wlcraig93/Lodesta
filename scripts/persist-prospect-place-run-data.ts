import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getSupabaseAdminClient } from "../lib/supabase/client";

type RankedCandidate = {
  placeId: string;
  name?: string;
  primaryType?: string;
  category?: string;
  address?: string;
  phone?: string;
  website?: string;
  mapsUrl?: string;
  rating?: number;
  reviewCount?: number;
  businessStatus?: string;
};

type RunResult = {
  prospectId: string;
  ranked?: RankedCandidate[];
};

type CandidateRow = {
  prospect_id: string;
  google_place_id: string;
  google_business_name: string | null;
  google_primary_type: string | null;
  google_category: string | null;
  google_address: string | null;
  google_phone: string | null;
  google_website_url: string | null;
  google_maps_url: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  google_business_status: string | null;
  updated_at: string;
};

async function main() {
  const runPaths = commaSeparatedArgument("--runs");
  if (!runPaths.length) throw new Error("--runs requires one or more comma-separated results.json paths.");

  const candidateByIdentity = new Map<string, CandidateRow>();
  for (const runPath of runPaths) {
    const payload = JSON.parse(await readFile(resolve(runPath), "utf8")) as { results?: RunResult[] };
    for (const result of payload.results ?? []) {
      for (const candidate of result.ranked ?? []) {
        const key = `${result.prospectId}|${candidate.placeId}`;
        const existing = candidateByIdentity.get(key);
        candidateByIdentity.set(key, {
          prospect_id: result.prospectId,
          google_place_id: candidate.placeId,
          google_business_name: candidate.name ?? existing?.google_business_name ?? null,
          google_primary_type: candidate.primaryType ?? existing?.google_primary_type ?? null,
          google_category: candidate.category ?? existing?.google_category ?? null,
          google_address: candidate.address ?? existing?.google_address ?? null,
          google_phone: candidate.phone ?? existing?.google_phone ?? null,
          google_website_url: candidate.website ?? existing?.google_website_url ?? null,
          google_maps_url: candidate.mapsUrl ?? existing?.google_maps_url ?? null,
          google_rating: candidate.rating ?? existing?.google_rating ?? null,
          google_review_count: candidate.reviewCount ?? existing?.google_review_count ?? null,
          google_business_status: candidate.businessStatus ?? existing?.google_business_status ?? null,
          updated_at: new Date().toISOString()
        });
      }
    }
  }

  const rows = [...candidateByIdentity.values()];
  const client = getSupabaseAdminClient();
  let persisted = 0;
  for (const batch of chunks(rows, 250)) {
    const result = await client.from("prospect_place_candidates")
      .upsert(batch, { onConflict: "prospect_id,google_place_id" })
      .select("prospect_id,google_place_id");
    if (result.error) throw new Error(`Persist Google candidates: ${result.error.message}`);
    persisted += result.data?.length ?? 0;
    console.log(JSON.stringify({ persisted, total: rows.length }));
  }

  console.log(JSON.stringify({ runFiles: runPaths.length, candidateRows: rows.length, persisted }, null, 2));
}

function commaSeparatedArgument(name: string) {
  const inline = process.argv.find((argument) => argument.startsWith(`${name}=`));
  const value = inline?.slice(name.length + 1);
  return value?.split(",").map((path) => path.trim()).filter(Boolean) ?? [];
}

function chunks<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

void main();
