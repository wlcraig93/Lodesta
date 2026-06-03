"use client";

import { useState, useTransition } from "react";
import { AdminButton } from "@/components/admin/AdminButton";

type RunGeneratedQaFormProps = {
  siteId: string;
  versionId: string;
};

export function RunGeneratedQaForm({ siteId, versionId }: RunGeneratedQaFormProps) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setMessage(null);
        startTransition(async () => {
          const response = await fetch("/api/generated-qa/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ siteId, versionId, autoRepair: true })
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            setMessage(payload.error ?? "Generated QA failed.");
            return;
          }
          setMessage(payload.repaired ? "Generated QA ran and applied one repair pass." : "Generated QA ran.");
          window.location.reload();
        });
      }}
    >
      <AdminButton variant="primary" type="submit" disabled={isPending}>
        {isPending ? "Running..." : "Run generated QA"}
      </AdminButton>
      {message ? <p className="muted">{message}</p> : null}
    </form>
  );
}
