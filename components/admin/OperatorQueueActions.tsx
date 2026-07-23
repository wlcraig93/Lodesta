"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OperatorQueueItem, SitePublicationReadiness, SiteVersion } from "@/packages/site-contracts";

export function OperatorQueueActions({ queueItem, version, readiness }: {
  queueItem?: OperatorQueueItem;
  version?: SiteVersion;
  readiness?: SitePublicationReadiness;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState("");

  async function act(action: "resolve" | "dismiss" | "publish") {
    setBusy(true); setError(undefined);
    try {
      const response = action === "publish" && version
        ? await fetch(`/api/site-versions/${version.id}/publish`, { method: "POST" })
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
    {version?.status === "candidate" && readiness?.status === "ready" ? <button className="button primary" type="button" disabled={busy} onClick={() => void act("publish")}>Publish version</button> : null}
    {queueItem ? <div className="button-row"><button className="button secondary" type="button" disabled={busy || !note.trim()} onClick={() => void act("resolve")}>Resolve finding</button><button className="button secondary" type="button" disabled={busy || !note.trim()} onClick={() => void act("dismiss")}>Dismiss finding</button></div> : null}
  </div>;
}
