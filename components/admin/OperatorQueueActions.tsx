"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OperatorQueueItemV1, SiteVersionV4 } from "@/packages/site-contracts";

export function OperatorQueueActions({ queueItem, version }: { queueItem?: OperatorQueueItemV1; version?: SiteVersionV4 }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function act(action: "resolve" | "dismiss" | "publish") {
    setBusy(true); setError(undefined);
    try {
      const response = action === "publish" && version
        ? await fetch(`/api/site-versions/${version.id}/publish`, { method: "POST" })
        : await fetch(`/api/operator/site-queue/${queueItem?.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }

  return <div className="finding-list">
    {error ? <p className="error-text">{error}</p> : null}
    {version?.status === "candidate" ? <button className="button primary" type="button" disabled={busy} onClick={() => void act("publish")}>Publish candidate</button> : null}
    {queueItem ? <div className="button-row"><button className="button secondary" type="button" disabled={busy} onClick={() => void act("resolve")}>Resolve</button><button className="button secondary" type="button" disabled={busy} onClick={() => void act("dismiss")}>Dismiss</button></div> : null}
  </div>;
}
