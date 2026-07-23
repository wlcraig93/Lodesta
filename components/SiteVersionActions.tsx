"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SiteVersion } from "@/packages/site-contracts";

export function SiteVersionActions({ version }: { version: SiteVersion }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function post(action: "publish" | "restore") {
    setBusy(true); setError(undefined);
    try {
      const response = await fetch(`/api/site-versions/${encodeURIComponent(version.id)}/${action}`, { method: "POST" });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `${action} failed (${response.status})`);
      router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  }
  return <div><div className="button-row"><a className="button secondary" href={`/api/site-versions/${version.id}/artifact/`}>Preview</a>{version.status === "candidate" ? <button className="button primary" type="button" disabled={busy} onClick={() => void post("publish")}>Publish</button> : null}<button className="button secondary" type="button" disabled={busy} onClick={() => void post("restore")}>Restore as candidate</button></div>{error ? <p className="error-text">{error}</p> : null}</div>;
}
