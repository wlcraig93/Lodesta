import Link from "next/link";
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

  return (
    <main className="setup-progress-page product-page">
      <WebsiteSetupProgress active={view.phase === "queued" || view.phase === "building"} />
      <header className="setup-progress-heading"><div><span>Website setup</span><h1>{heading(view.phase, setup.failureCode)}</h1><p>{description(view.phase, setup.failureReason ?? view.run?.failureReason)}</p></div><span className="setup-phase-badge" data-phase={view.phase}>{phaseLabel(view.phase)}</span></header>

      {view.phase === "review_draft" ? (
        <>
          <section className="setup-preview-panel"><div><div><span>Private draft</span><strong>Read-only review</strong></div><p>Forms, scripts, and external connections are disabled here.</p></div><iframe title="Private website draft" src={`/api/website-setups/${setup.id}/preview`} sandbox="allow-same-origin" /></section>
          <section className="setup-next-step"><div><span>Ready to continue?</span><h2>Open your website</h2><p>This project already belongs to your account. Open the workspace to edit it or publish it to its Lodesta URL.</p></div>{view.openPath ? <Link className="button primary" href={view.openPath}>Open website</Link> : null}</section>
        </>
      ) : null}

      {view.phase === "queued" || view.phase === "building" ? <section className="setup-building-card"><div className="setup-building-indicator" aria-hidden="true"><i /><i /><i /></div><div><h2>{view.phase === "queued" ? "Waiting to begin" : "Building your private draft"}</h2><p>You can leave this page. Your setup record is durable and this page will update when the draft is ready.</p></div></section> : null}

      {view.phase === "needs_attention" ? (
        <section className="setup-attention-card">
          <div><span>Setup paused</span><h2>We couldn’t finish this attempt</h2><p>{setup.failureReason ?? view.run?.failureReason ?? "Retry the same source, use a different website address, or cancel this setup."}</p></div>
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

function heading(phase: string, _code?: string) { if (phase === "review_draft") return "Your draft is ready"; if (phase === "needs_attention") return "Choose your next step"; return "We’re creating your website"; }
function description(phase: string, reason?: string) { if (phase === "review_draft") return "Review the private version below, then open the workspace to edit or publish it."; if (phase === "needs_attention") return reason ?? "This setup needs your attention before it can continue."; return "Lodesta is using your current public website as the factual starting point."; }
function phaseLabel(phase: string) { return phase === "review_draft" ? "Draft ready" : phase === "needs_attention" ? "Needs attention" : phase === "building" ? "Building" : "Queued"; }
