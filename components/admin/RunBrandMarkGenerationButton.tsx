"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminButton } from "@/components/admin/AdminButton";

type BrandMarkGenerationResponse = {
  summary?: string;
  error?: string;
};

export function RunBrandMarkGenerationButton({
  siteId,
  versionId
}: {
  siteId: string;
  versionId: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function runGate() {
    if (submitting) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/sites/brand-mark-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, versionId })
      });
      const payload = (await response.json().catch(() => ({}))) as BrandMarkGenerationResponse;
      if (!response.ok) {
        setMessage(payload.error ?? "Brand mark gate failed.");
        return;
      }
      setMessage(payload.summary ?? "Brand mark gate recorded.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Brand mark gate failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <AdminButton variant="secondary" type="button" onClick={runGate} disabled={submitting}>
        {submitting ? "Recording..." : "Record brand mark gate"}
      </AdminButton>
      {message ? <p className="form-status">{message}</p> : null}
    </div>
  );
}
