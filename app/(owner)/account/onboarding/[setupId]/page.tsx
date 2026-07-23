import { notFound, redirect } from "next/navigation";
import { WebsiteSetupAction, WebsiteSetupProgress, WebsiteSetupSourceForm } from "@/components/WebsiteSetupControls";
import { requireOwnerAccess } from "@/lib/page-access";
import { getWebsiteSetupView } from "@/lib/website-setups";
import { platformOperationsRepository } from "@/packages/platform-operations";

export const dynamic = "force-dynamic";

export default async function WebsiteSetupPage({ params }: { params: Promise<{ setupId: string }> }) {
  const { setupId } = await params;
  const access = await requireOwnerAccess(`/account/onboarding/${setupId}`);
  if (!access.user) redirect("/account/onboarding");
  const setup = await platformOperationsRepository.getWebsiteSetup(setupId);
  if (!setup || setup.ownerUserId !== access.user.id) notFound();
  if (setup.status === "canceled") redirect("/account/onboarding");
  const view = await getWebsiteSetupView(setup);
  if (setup.status === "linked" && view.openPath) redirect(view.openPath);

  return (
    <main className="setup-progress-page product-page">
      <WebsiteSetupProgress active={view.phase === "queued" || view.phase === "building"} />

      {view.phase === "queued" || view.phase === "building" ? <section className="setup-building-card"><div className="setup-building-indicator" aria-hidden="true"><i /><i /><i /></div><div><h1>Reading your website…</h1><p>We’ll open your website workspace as soon as the first build begins.</p></div></section> : null}

      {view.phase === "needs_attention" ? (
        <section className="setup-attention-card">
          <div><h1>We couldn’t create this website</h1><p>{view.message}</p></div>
          <div className="button-row">
            {view.canRetry ? <WebsiteSetupAction setupId={setup.id} action="retry" label="Retry setup" tone="primary" /> : null}
            {view.canCancel ? <WebsiteSetupAction setupId={setup.id} action="cancel" label="Cancel setup" /> : null}
          </div>
          {setup.status !== "linked" ? <WebsiteSetupSourceForm setupId={setup.id} sourceUrl={setup.sourceUrl} /> : null}
        </section>
      ) : null}

      {view.phase !== "needs_attention" && view.canCancel ? <div className="setup-footer-actions"><WebsiteSetupAction setupId={setup.id} action="cancel" label="Cancel setup" /></div> : null}
    </main>
  );
}
