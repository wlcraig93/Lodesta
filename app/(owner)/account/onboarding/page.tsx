import { WebsiteOnboardingForm } from "@/components/WebsiteOnboardingForm";
import { requireOwnerAccess } from "@/lib/page-access";

export default async function WebsiteOnboardingPage({
  searchParams
}: {
  searchParams: Promise<{ source?: string; reportId?: string }>;
}) {
  const params = await searchParams;
  const source = typeof params.source === "string" ? params.source.slice(0, 2048) : "";
  const reportId = typeof params.reportId === "string" && /^prospect_report_[a-f0-9]{32}$/i.test(params.reportId)
    ? params.reportId
    : undefined;
  const nextParams = new URLSearchParams();
  if (source) nextParams.set("source", source);
  if (reportId) nextParams.set("reportId", reportId);
  const nextPath = `/account/onboarding${nextParams.size ? `?${nextParams.toString()}` : ""}`;
  const access = await requireOwnerAccess(nextPath);
  if (!access.configured) {
    return <main className="onboarding-page product-page"><section className="onboarding-card"><h1>Sign in to create a website</h1><p>Website creation is unavailable while authentication is disabled.</p></section></main>;
  }
  return (
    <main className="onboarding-page product-page">
      <section className="onboarding-card">
        <h1>Create a website</h1>
        <p>
          {source
            ? "Lodesta will use this public source to create a private website you can review and customize."
            : reportId
              ? "We did not find an owned website in your report. Paste another public business source and Lodesta will create a private website you can review."
              : "Paste an existing website or public business source and Lodesta will create a new version you can customize."}
        </p>
        <WebsiteOnboardingForm initialSource={source} />
        <ol className="onboarding-steps" aria-label="What happens next">
          <li><span>1</span><div><strong>We learn the essentials</strong><small>Lodesta reviews your current website and business details.</small></div></li>
          <li><span>2</span><div><strong>You review a private draft</strong><small>Make changes with the editor before anything goes live.</small></div></li>
          <li><span>3</span><div><strong>Publish when it feels right</strong><small>Your existing website stays untouched until you choose to publish.</small></div></li>
        </ol>
      </section>
    </main>
  );
}
