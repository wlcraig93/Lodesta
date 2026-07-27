import { NextResponse } from "next/server";
import { buildOutboundMailerManifest, outboundMailerManifestCsv } from "@/packages/acquisition/outbound";
import {
  isActivePreviewGrant,
  platformOperationsRepository as repository,
  previewLink
} from "@/packages/platform-operations";
import { requireAdmin } from "@/lib/security";
import { outboundReportUrl } from "@/packages/acquisition/outbound-report-assets";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const requestUrl = new URL(request.url);
  const campaignId = requestUrl.searchParams.get("campaignId") ?? undefined;
  const format = requestUrl.searchParams.get("format") ?? "json";
  const [campaigns, prospects, grants, reports] = await Promise.all([
    repository.listOutboundCampaigns(),
    repository.listOutboundProspects(campaignId),
    repository.listPreviewGrants(),
    repository.listProspectReports(500)
  ]);
  const previewLinks = new Map(
    grants
      .filter(isActivePreviewGrant)
      .map((grant) => [grant.id, previewLink(grant, requestUrl.origin)])
  );
  const reportLinks = new Map(
    reports
      .map((report) => [
        report.id,
        {
          url: report.accessPolicy === "public_link"
            ? outboundReportUrl(requestUrl.origin, report.id)
            : "",
          status: report.status
        }
      ])
  );
  const rows = buildOutboundMailerManifest(campaigns, prospects, campaignId, previewLinks, reportLinks);

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
