import { NextResponse } from "next/server";
import { appOriginFromRequest } from "@/lib/app-origin";
import { requireAdmin } from "@/lib/security";
import {
  createOrReuseProspectReport,
  ProspectReportGenerationError,
  prospectReportUsesCurrentAssessment
} from "@/packages/acquisition/prospect-report-generation";
import { outboundReportUrl } from "@/packages/acquisition/outbound-report-assets";
import { setOutboundReportOperatorCookie } from "@/packages/acquisition/report-access";
import { publicProspectReport } from "@/packages/acquisition/prospect-reports";
import {
  platformOperationsRepository as repository,
  type ProspectReportRecord
} from "@/packages/platform-operations";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ prospectId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const { prospectId } = await params;
  const prospect = await repository.getOutboundProspect(prospectId);
  if (!prospect?.reportId) {
    return NextResponse.json({ error: "This prospect does not have a report." }, { status: 404 });
  }
  const report = await repository.getProspectReport(prospect.reportId);
  if (!report || report.accessPolicy !== "public_link") {
    return NextResponse.json({ error: "Direct report access is not active." }, { status: 409 });
  }
  const response = NextResponse.redirect(canonicalReportUrl(request, report.id));
  setOutboundReportOperatorCookie(response, request, report.id);
  return response;
}

export async function POST(request: Request, { params }: { params: Promise<{ prospectId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const { prospectId } = await params;
  const prospect = await repository.getOutboundProspect(prospectId);
  if (!prospect) return NextResponse.json({ error: "Unknown outbound prospect." }, { status: 404 });
  if (!prospect.sourceUrl) {
    return NextResponse.json(
      { error: "Add a source website before creating a public report." },
      { status: 400 }
    );
  }

  if (prospect.reportId) {
    const current = await repository.getProspectReport(prospect.reportId);
    if (
      current
      && current.accessPolicy === "public_link"
      && current.status !== "failed"
      && await prospectReportUsesCurrentAssessment(current)
    ) {
      return NextResponse.json(outboundReportResponse(request, current, true));
    }
  }

  try {
    const created = await createOrReuseProspectReport({
      query: prospect.sourceUrl,
      accessPolicy: "public_link"
    });
    const attached = await repository.attachOutboundProspectReport(prospect.id, created.report.id);
    if (!attached) {
      return NextResponse.json({ error: "Unable to attach the report to this prospect." }, { status: 500 });
    }
    return NextResponse.json(
      outboundReportResponse(request, created.report, created.reused),
      { status: created.job ? 202 : 200 }
    );
  } catch (error) {
    if (error instanceof ProspectReportGenerationError) {
      return NextResponse.json({ error: error.publicMessage }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to create the outbound report." }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ prospectId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const { prospectId } = await params;
  const prospect = await repository.getOutboundProspect(prospectId);
  if (!prospect?.reportId) {
    return NextResponse.json({ error: "This prospect does not have a report." }, { status: 404 });
  }
  const report = await repository.getProspectReport(prospect.reportId);
  if (!report) return NextResponse.json({ error: "Unknown report." }, { status: 404 });
  const revoked = await repository.updateProspectReport({
    reportId: report.id,
    accessPolicy: "email_gate"
  });
  if (!revoked) return NextResponse.json({ error: "Unable to revoke direct access." }, { status: 500 });
  return NextResponse.json({
    revoked: true,
    report: publicProspectReport(revoked),
    reportUrl: canonicalReportUrl(request, revoked.id)
  });
}

function outboundReportResponse(request: Request, report: ProspectReportRecord, reused: boolean) {
  return {
    report: publicProspectReport(report),
    reportUrl: canonicalReportUrl(request, report.id),
    reused
  };
}

function canonicalReportUrl(request: Request, reportId: string) {
  return outboundReportUrl(appOriginFromRequest(request), reportId);
}
