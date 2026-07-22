"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OperatorQueueItemV2, SitePublicationReadinessV1, SiteVersionV4 } from "@/packages/site-contracts";

export function OperatorQueueActions({ queueItem, version, readiness }: {
  queueItem?: OperatorQueueItemV2;
  version?: SiteVersionV4;
  readiness?: SitePublicationReadinessV1;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState("");

  async function act(action: "resolve" | "dismiss" | "approve" | "reject" | "publish") {
    setBusy(true); setError(undefined);
    try {
      const response = action === "publish" && version
        ? await fetch(`/api/site-versions/${version.id}/publish`, { method: "POST" })
        : (action === "approve" || action === "reject") && version
          ? await fetch(`/api/site-versions/${version.id}/review`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ status: action === "approve" ? "approved" : "rejected", note })
            })
          : await fetch(`/api/operator/site-queue/${queueItem?.id}`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action, note })
            });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }

  return <div className="finding-list">
    {error ? <p className="error-text">{error}</p> : null}
    {version || queueItem ? <label>Decision note<textarea value={note} onChange={(event) => setNote(event.target.value)} /></label> : null}
    {version?.status === "candidate" ? <>
      <div className="button-row">
        <button className="button primary" type="button" disabled={busy || !note.trim() || Boolean(readiness?.blockers.some((blocker) => blocker.code !== "operator_approval"))} onClick={() => void act("approve")}>Approve exact version</button>
        <button className="button secondary" type="button" disabled={busy || !note.trim()} onClick={() => void act("reject")}>Reject</button>
      </div>
      {readiness?.status === "ready" ? <button className="button primary" type="button" disabled={busy} onClick={() => void act("publish")}>Publish approved version</button> : null}
    </> : null}
    {queueItem ? <div className="button-row"><button className="button secondary" type="button" disabled={busy || !note.trim()} onClick={() => void act("resolve")}>Resolve finding</button><button className="button secondary" type="button" disabled={busy || !note.trim()} onClick={() => void act("dismiss")}>Dismiss finding</button></div> : null}
  </div>;
}
