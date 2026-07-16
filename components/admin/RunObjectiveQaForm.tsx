"use client";

import { useState, useTransition } from "react";
import { AdminButton } from "@/components/admin/AdminButton";

export function RunObjectiveQaForm({ siteId, versionId }: { siteId: string; versionId: string }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setMessage(null);
        startTransition(async () => {
          const response = await fetch("/api/sites/qa", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ siteId, versionId })
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            setMessage(payload.error ?? payload.qa?.blockers?.[0]?.detail ?? "Objective QA failed.");
            return;
          }
          setMessage("Objective QA passed.");
          window.location.reload();
        });
      }}
    >
      <AdminButton variant="primary" type="submit" disabled={isPending}>
        {isPending ? "Running..." : "Run objective QA"}
      </AdminButton>
      {message ? <p className="muted">{message}</p> : null}
    </form>
  );
}
