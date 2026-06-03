"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminButton } from "@/components/admin/AdminButton";

type BrandDirectionResponse = {
  summary?: string;
  error?: string;
};

export function RunBrandDirectionButton({
  siteId,
  versionId
}: {
  siteId: string;
  versionId: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function runBrandDirection() {
    if (submitting) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/sites/brand-direction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, versionId })
      });
      const payload = (await response.json().catch(() => ({}))) as BrandDirectionResponse;
      if (!response.ok) {
        setMessage(payload.error ?? "Brand direction failed.");
        return;
      }
      setMessage(payload.summary ?? "Brand direction prepared.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Brand direction failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <AdminButton variant="secondary" type="button" onClick={runBrandDirection} disabled={submitting}>
        {submitting ? "Running..." : "Prepare brand direction"}
      </AdminButton>
      {message ? <p className="form-status">{message}</p> : null}
    </div>
  );
}
