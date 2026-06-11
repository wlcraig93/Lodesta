"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminButton } from "@/components/admin/AdminButton";

export function RegenerateCandidateButton({ sourceUrl }: { sourceUrl: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function regenerate() {
    if (submitting) return;
    if (!window.confirm("Queue a fresh generation from the same source? The current candidate stays untouched.")) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sourceUrl, telemetrySource: "admin_console" })
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Regeneration failed.");
        return;
      }
      router.push("/admin/site-candidates?view=generating");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Regeneration failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <AdminButton variant="secondary" type="button" onClick={regenerate} disabled={submitting}>
        {submitting ? "Queueing..." : "Regenerate"}
      </AdminButton>
      {error ? <p className="form-status error-text">{error}</p> : null}
    </div>
  );
}
