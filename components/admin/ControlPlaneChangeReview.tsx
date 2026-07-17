"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ControlPlaneChangeRequestV1 } from "@/lib/control-plane-contracts";
import { AdminButton, AdminButtonRow } from "./AdminButton";

export function ControlPlaneChangeReview({ siteId, initialChanges }: { siteId: string; initialChanges: ControlPlaneChangeRequestV1[] }) {
  const router = useRouter();
  const [changes, setChanges] = useState(initialChanges.filter((change) => change.status === "pending"));
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();

  async function decide(requestId: string, decision: "approve" | "reject") {
    setBusyId(requestId);
    setError(undefined);
    const response = await fetch(`/api/control-plane/changes/${encodeURIComponent(requestId)}?siteId=${encodeURIComponent(siteId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(typeof payload.error === "string" ? payload.error : "The change could not be decided.");
      setBusyId(undefined);
      return;
    }
    setChanges((current) => current.filter((change) => change.id !== requestId));
    setBusyId(undefined);
    router.refresh();
  }

  return (
    <section className="panel">
      <div className="section-heading-row">
        <div>
          <span className="badge">Control plane</span>
          <h2>Pending reviewed changes</h2>
          <p className="muted">Trust-sensitive changes stay out of canonical state until an operator decides them.</p>
        </div>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {changes.length ? (
        <div className="finding-list">
          {changes.map((change) => (
            <article className="finding-card" key={change.id}>
              <span className="badge">{change.targetAuthority.replace("_", " ")}</span>
              <h3>{change.payload.kind.replaceAll("_", " ")}</h3>
              <p className="muted">Requested {new Date(change.requestedAt).toLocaleString()}</p>
              <pre className="code-block">{JSON.stringify(change.payload, null, 2)}</pre>
              <AdminButtonRow>
                <AdminButton variant="primary" size="sm" disabled={Boolean(busyId)} onClick={() => decide(change.id, "approve")}>Approve</AdminButton>
                <AdminButton variant="secondary" size="sm" disabled={Boolean(busyId)} onClick={() => decide(change.id, "reject")}>Reject</AdminButton>
              </AdminButtonRow>
            </article>
          ))}
        </div>
      ) : <p className="muted">No reviewed changes are waiting.</p>}
    </section>
  );
}
