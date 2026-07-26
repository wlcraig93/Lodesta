"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { WebsiteSetupView } from "@/lib/website-setups";
import { websiteSetupHostname, websiteSetupOwnerInstruction } from "@/lib/website-setup-copy";
import { WebsiteBuildCanvas } from "@/components/WebsiteBuildCanvas";
import { WebsiteSetupAction, WebsiteSetupSourceForm } from "@/components/WebsiteSetupControls";
import { WebsiteWorkspaceFrame, type MobilePane } from "@/components/WebsiteWorkspaceFrame";

const activePollMs = 2_000;
const hiddenPollMs = 8_000;

export function WebsiteSetupWorkspace({ initialView }: { initialView: WebsiteSetupView }) {
  const router = useRouter();
  const [view, setView] = useState(initialView);
  const [notice, setNotice] = useState<string>();
  const [mobilePane, setMobilePane] = useState<MobilePane>("chat");
  const composerUnavailableId = useId();
  const progress = setupProgress(view);
  const sourceHost = websiteSetupHostname(view.setup.sourceUrl);
  const active = view.phase === "queued" || view.phase === "building";

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: number | undefined;
    const controller = new AbortController();

    async function poll() {
      try {
        const response = await fetch(`/api/website-setups/${encodeURIComponent(view.setup.id)}`, {
          cache: "no-store",
          signal: controller.signal
        });
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          router.replace("/account/onboarding");
          return;
        }
        if (!response.ok) throw new Error(`Setup refresh failed (${response.status})`);
        const result = await response.json() as { view: WebsiteSetupView };
        if (stopped) return;
        setNotice(undefined);
        if (result.view.setup.status === "canceled") {
          router.replace("/account/onboarding");
          return;
        }
        if (result.view.setup.status === "linked" && result.view.openPath) {
          router.replace(result.view.openPath);
          return;
        }
        setView(result.view);
      } catch (error) {
        if (!stopped && !controller.signal.aborted) {
          setNotice("The latest progress could not be loaded. Lodesta will keep trying.");
        }
      } finally {
        if (!stopped) {
          timer = window.setTimeout(poll, document.hidden ? hiddenPollMs : activePollMs);
        }
      }
    }

    timer = window.setTimeout(poll, document.hidden ? hiddenPollMs : activePollMs);
    return () => {
      stopped = true;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [active, router, view.setup.id]);

  function acceptView(next: WebsiteSetupView) {
    setNotice(undefined);
    if (next.setup.status === "canceled") {
      router.replace("/account/onboarding");
      return;
    }
    if (next.setup.status === "linked" && next.openPath) {
      router.replace(next.openPath);
      return;
    }
    setView(next);
  }

  const setupActions = (
    <div className="site-agent-setup-actions">
      {view.canRetry ? <WebsiteSetupAction setupId={view.setup.id} action="retry" label="Retry setup" tone="primary" onView={acceptView} /> : null}
      {view.canCancel ? <WebsiteSetupAction setupId={view.setup.id} action="cancel" label="Cancel setup" onView={acceptView} /> : null}
    </div>
  );

  return (
    <WebsiteWorkspaceFrame
      storageId={`setup:${view.setup.id}`}
      backHref="/account"
      backLabel="Back to all websites"
      mobilePane={mobilePane}
      onMobilePaneChange={setMobilePane}
      commandTitle={
        <div className="site-agent-command-title">
          <strong>{sourceHost}</strong>
          <small className={view.phase === "needs_attention" ? "is-attention" : "is-working"}>Creating website · {progress.shortLabel}</small>
        </div>
      }
      previewToolbar={
        <div className="site-agent-preview-primary">
          <span className="site-agent-preview-tab" aria-current="page">{view.phase === "needs_attention" ? "Build paused" : "Building private draft"}</span>
        </div>
      }
      commandContent={
        <>
          <div className="site-agent-messages site-agent-setup-messages" aria-live="polite" aria-busy={active ? true : undefined}>
            <article className="site-agent-message is-owner" aria-label="Your message">
              <p>{websiteSetupOwnerInstruction(view.setup.sourceUrl)}</p>
            </article>
            <article className="site-agent-message is-agent" aria-label="Lodesta message">
              <p>I’ll review the public website, gather the essential business details, and create a private draft. Your current website will not be changed.</p>
            </article>
            <div className={`site-agent-runline site-agent-setup-progress ${view.phase === "needs_attention" ? "is-error" : ""}`} role={view.phase === "needs_attention" ? "alert" : "status"}>
              <span />
              <div>
                <strong>{progress.label}</strong>
                <small>{progress.detail}</small>
                <details className="site-agent-run-details">
                  <summary>What Lodesta is doing</summary>
                  <div className="site-agent-run-detail-content">
                    <p>{progress.expandedDetail}</p>
                    <dl>
                      <div><dt>Source</dt><dd><a href={view.setup.sourceUrl} target="_blank" rel="noreferrer">{sourceHost}</a></dd></div>
                      <div><dt>Visibility</dt><dd>Private until you publish</dd></div>
                    </dl>
                  </div>
                </details>
                {setupActions}
              </div>
            </div>
            {view.phase === "needs_attention" ? <WebsiteSetupSourceForm setupId={view.setup.id} sourceUrl={view.setup.sourceUrl} onView={acceptView} /> : null}
            {notice ? <div className="site-agent-inline-notice" role="status">{notice}</div> : null}
          </div>
          <div className="site-agent-compose is-unavailable">
            <span className="site-agent-visually-hidden" id={composerUnavailableId}>Available when your first draft is ready.</span>
            <textarea value="" readOnly disabled aria-describedby={composerUnavailableId} placeholder="Available when your first draft is ready" rows={1} />
            <div className="site-agent-compose-footer">
              <span className="site-agent-setup-composer-status">{active ? "First draft in progress" : "Setup needs attention"}</span>
              <button className="site-agent-send-button" type="button" aria-label="Available when your first draft is ready" disabled>
                <ArrowUpIcon />
              </button>
            </div>
          </div>
        </>
      }
      previewContent={
        <div className="site-agent-preview-stage site-agent-setup-preview-stage">
          <WebsiteBuildCanvas
            stage={progress.canvasStage}
            title={progress.canvasTitle}
            detail={progress.canvasDetail}
            sourceLabel={sourceHost}
          />
        </div>
      }
    />
  );
}

function setupProgress(view: WebsiteSetupView) {
  if (view.phase === "needs_attention") {
    return {
      shortLabel: "Needs attention",
      label: "Website setup needs attention",
      detail: view.message ?? "Lodesta could not finish preparing this website.",
      expandedDetail: "Retry a temporary interruption, or choose a different public website if this address cannot be read.",
      canvasStage: "attention" as const,
      canvasTitle: "Build paused",
      canvasDetail: "Resolve the setup issue in Chat to continue."
    };
  }
  if (view.setup.status === "queued") {
    return {
      shortLabel: "Waiting",
      label: "Waiting to begin",
      detail: "Your request is queued and ready for Lodesta.",
      expandedDetail: "Lodesta will begin by reading the public pages at the source address and collecting business information that can be verified.",
      canvasStage: "queued" as const,
      canvasTitle: "Waiting to begin",
      canvasDetail: "Your private workspace is ready for Lodesta to start."
    };
  }
  return {
    shortLabel: "Learning",
    label: "Learning about your business",
    detail: "Lodesta is reading the public website and preparing the authoring workspace.",
    expandedDetail: "The source is being reviewed for services, contact details, branding, and other evidence that can support the private draft.",
    canvasStage: "gathering" as const,
    canvasTitle: "Gathering the essentials",
    canvasDetail: "Reading the public website and organizing verified business information."
  };
}

function ArrowUpIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16V4m0 0L5.5 8.5M10 4l4.5 4.5" /></svg>;
}
