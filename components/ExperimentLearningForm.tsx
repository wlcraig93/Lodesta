"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ExperimentLearningFormProps = {
  siteId: string;
  experimentId: string;
  disabledReason?: string;
};

export function ExperimentLearningForm({ siteId, experimentId, disabledReason }: ExperimentLearningFormProps) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  async function adoptLearning() {
    setPending(true);
    setStatus("Adopting winner as a generation learning...");
    const response = await fetch("/api/experiments/learn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, experimentId })
    });
    const result = await response.json();
    setPending(false);
    if (!response.ok || !result.ok) {
      setStatus(result.error ?? "Unable to adopt learning.");
      return;
    }
    setStatus("Learning adopted. Future generated sites can use this default.");
    router.refresh();
  }

  if (disabledReason) return <p className="form-status">{disabledReason}</p>;

  return (
    <div className="button-row">
      <button className="button primary" disabled={pending} type="button" onClick={() => void adoptLearning()}>
        {pending ? "Adopting..." : "Adopt winner"}
      </button>
      {status ? <p className="form-status">{status}</p> : null}
    </div>
  );
}
