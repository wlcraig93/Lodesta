import { NextResponse } from "next/server";
import { buildOutboundMailerManifest, outboundMailerManifestCsv } from "@/lib/outbound";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const requestUrl = new URL(request.url);
  const campaignId = requestUrl.searchParams.get("campaignId") ?? undefined;
  const format = requestUrl.searchParams.get("format") ?? "json";
  const [campaigns, prospects] = await Promise.all([
    repository.listOutboundCampaigns(),
    repository.listOutboundProspects(campaignId)
  ]);
  const rows = buildOutboundMailerManifest(campaigns, prospects, campaignId, requestUrl.origin);

  if (format === "csv") {
    return new Response(outboundMailerManifestCsv(rows), {
      headers: {
        "Content-Disposition": `attachment; filename="lodesta-outbound-manifest${campaignId ? `-${campaignId}` : ""}.csv"`,
        "Content-Type": "text/csv; charset=utf-8"
      }
    });
  }

  return NextResponse.json({
    campaignId,
    count: rows.length,
    rows
  });
}
