import { appOriginFromRequest } from "@/lib/app-origin";
import { requireAdmin } from "@/lib/security";
import {
  outboundReportQrSvg,
  outboundReportUrl
} from "@/packages/acquisition/outbound-report-assets";
import { platformOperationsRepository as repository } from "@/packages/platform-operations";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ prospectId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const { prospectId } = await params;
  const prospect = await repository.getOutboundProspect(prospectId);
  if (!prospect?.reportId) {
    return Response.json({ error: "Create a report before downloading its QR code." }, { status: 404 });
  }
  const report = await repository.getProspectReport(prospect.reportId);
  if (!report || report.accessPolicy !== "public_link") {
    return Response.json({ error: "Direct report access is not active." }, { status: 409 });
  }
  const reportUrl = outboundReportUrl(appOriginFromRequest(request), report.id);
  const svg = await outboundReportQrSvg(reportUrl);
  const safeProspectId = prospect.id.replace(/[^a-z0-9_-]/gi, "-").slice(0, 80) || "prospect";
  return new Response(svg, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="lodesta-website-health-report-${safeProspectId}.svg"`,
      "Content-Type": "image/svg+xml; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
