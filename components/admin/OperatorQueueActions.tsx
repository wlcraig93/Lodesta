"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OperatorQueueItem } from "@/packages/site-contracts";

export function OperatorQueueActions({ queueItem }: {
  queueItem?: OperatorQueueItem;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState("");

  async function act(action: "resolve" | "dismiss") {
    setBusy(true); setError(undefined);
    try {
      const response = await fetch(`/api/operator/site-queue/${queueItem?.id}`, {
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
    {queueItem ? <label>Decision note<textarea value={note} onChange={(event) => setNote(event.target.value)} /></label> : null}
    {queueItem ? <div className="button-row"><button className="button secondary" type="button" disabled={busy || !note.trim()} onClick={() => void act("resolve")}>Resolve finding</button><button className="button secondary" type="button" disabled={busy || !note.trim()} onClick={() => void act("dismiss")}>Dismiss finding</button></div> : null}
  </div>;
}
