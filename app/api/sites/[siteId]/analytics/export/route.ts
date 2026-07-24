import { NextResponse } from "next/server";
import { parseAnalyticsQuery } from "@/lib/analytics-query";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { requireAdminOrSiteOwner } from "@/lib/security";
import { siteCapabilityRepository } from "@/packages/site-capabilities";
import { sitePlatformRepository } from "@/packages/platform-data";
import type { AnalyticsReport, AnalyticsReportRow } from "@/packages/site-capabilities/contracts";

export async function GET(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const limit = rateLimit(request, { bucket: "analytics_export", limit: 20, windowMs: 60_000 });
  if (!limit.ok) return limit.response;
  const { siteId } = await params;
  const unauthorized = await requireAdminOrSiteOwner(request, siteId);
  if (unauthorized) return applyRateLimitHeaders(unauthorized, limit);
  const site = await sitePlatformRepository.getSite(siteId);
  if (!site) return applyRateLimitHeaders(NextResponse.json({ error: "Website not found." }, { status: 404 }), limit);
  const publishedVersion = site.publishedVersionId
    ? await sitePlatformRepository.getSiteVersion(site.publishedVersionId)
    : undefined;

  const url = new URL(request.url);
  const search = Object.fromEntries(url.searchParams.entries());
  const query = parseAnalyticsQuery(search, {
    timezone: site.reportingTimezone,
    siteCreatedAt: publishedVersion?.publishedAt ?? site.createdAt
  });
  const report = await siteCapabilityRepository.analyticsReport(site.id, query);
  const csv = reportCsv(report);
  const response = new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${safeFilename(site.slug)}-analytics-${query.from}-${query.to}.csv"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff"
    }
  });
  return applyRateLimitHeaders(response, limit);
}

function reportCsv(report: AnalyticsReport) {
  const metadata = [
    ["Lodesta website analytics"],
    ["Site ID", report.siteId],
    ["View", report.query.view],
    ["From", report.query.from],
    ["To", report.query.to],
    ["Timezone", report.query.timezone],
    [],
    ["Metric", "Value"],
    ["Visitors", report.current.visitors],
    ["Visits", report.current.visits],
    ["Page views", report.current.pageViews],
    ["Leads", report.current.leads],
    ["Customer actions", report.current.customerActions],
    ["Action rate", report.current.actionRate]
  ];
  const rows = report.query.view === "traffic"
    ? sections([["Channels", report.channels], ["Sources", report.sources], ["Campaigns", report.campaigns], ["Visitor types", report.visitorTypes], ["Landing pages", report.landingPages], ["Devices", report.devices]])
    : report.query.view === "content"
      ? sections([["Pages", report.pages]])
      : report.query.view === "actions"
        ? sections([["Actions", report.actions], ["Landing pages", report.landingPages], ["Pages", report.pages], ["Devices", report.devices]])
        : sections([["Channels", report.channels], ["Actions", report.actions], ["Pages", report.pages]]);
  return `\uFEFF${[...metadata, [], ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function sections(values: Array<[string, AnalyticsReportRow[]]>) {
  return values.flatMap(([title, rows], index) => [
    ...(index ? [[]] : []),
    [title],
    ["Key", "Label", "Visitors", "Visits", "Page views", "Customer actions", "Action rate", "Engaged seconds"],
    ...rows.map((row) => [row.key, row.label, row.visitors, row.visits, row.pageViews, row.customerActions, row.actionRate, row.engagedSeconds])
  ]);
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function safeFilename(value: string) {
  return value.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "") || "website";
}
