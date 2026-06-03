"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminButton } from "@/components/admin/AdminButton";

type OptimizationReportsResponse = {
  summary?: string;
  error?: string;
};

export function RunOptimizationReportsButton({
  siteId,
  versionId
}: {
  siteId: string;
  versionId: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function runAudit() {
    if (submitting) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/sites/optimization-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, versionId })
      });
      const payload = (await response.json().catch(() => ({}))) as OptimizationReportsResponse;
      if (!response.ok) {
        setMessage(payload.error ?? "Optimization reports failed.");
        return;
      }
      setMessage(payload.summary ?? "Optimization reports ran.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Optimization reports failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <AdminButton variant="secondary" type="button" onClick={runAudit} disabled={submitting}>
        {submitting ? "Running..." : "Run optimization reports"}
      </AdminButton>
      {message ? <p className="form-status">{message}</p> : null}
    </div>
  );
}
