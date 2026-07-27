import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WebsiteHealthReportClient } from "./website-health-report-client";

export const metadata: Metadata = {
  title: "Your Website Health Report | Lodesta",
  description: "Evidence-backed website findings and practical recommendations from Lodesta.",
  robots: { index: false, follow: false }
};

export default async function WebsiteHealthReportResultPage({
  params
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  if (!/^prospect_report_[a-f0-9]{32}$/i.test(reportId)) notFound();
  return <WebsiteHealthReportClient reportId={reportId} />;
}
