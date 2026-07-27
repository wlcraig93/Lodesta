import type { Metadata } from "next";
import { WebsiteHealthReportForm } from "@/components/WebsiteHealthReportForm";

export const metadata: Metadata = {
  title: "Website Health Report | Lodesta",
  description: "See what is working on your website, what could improve, and the evidence behind every suggestion.",
  robots: { index: false, follow: false }
};

export default function WebsiteHealthReportPage() {
  return (
    <main className="health-report-entry">
      <section>
        <p className="eyebrow">Free Website Health Report</p>
        <h1>See how well your website helps customers take the next step.</h1>
        <p>
          We check whether customers can find, understand, trust, use, and act on your website—then explain the
          evidence and what you can improve.
        </p>
        <WebsiteHealthReportForm buttonLabel="Get my Website Health Report" />
      </section>
    </main>
  );
}
