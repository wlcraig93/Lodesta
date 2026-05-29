"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Experiment } from "@/lib/models";

type ExperimentControlFormProps = {
  siteId: string;
  experimentId: string;
  status: Experiment["status"];
};

type Action = {
  label: string;
  status: Experiment["status"];
  style: "primary" | "secondary";
};

export function ExperimentControlForm({ siteId, experimentId, status }: ExperimentControlFormProps) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pendingStatus, setPendingStatus] = useState<Experiment["status"] | null>(null);
  const actions = actionsForStatus(status);

  async function updateExperiment(nextStatus: Experiment["status"]) {
    setPendingStatus(nextStatus);
    setMessage(statusMessage(nextStatus, "pending"));
    const response = await fetch("/api/experiments/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, experimentId, status: nextStatus })
    });
    const result = await response.json();
    setPendingStatus(null);
    if (!response.ok || !result.ok) {
      setMessage(result.error ?? "Unable to update experiment.");
      return;
    }
    setMessage(statusMessage(nextStatus, "done"));
    router.refresh();
  }

  return (
    <div className="experiment-controls">
      <div className="button-row">
        {actions.map((action) => (
          <button
            className={`button ${action.style}`}
            disabled={Boolean(pendingStatus)}
            key={action.status}
            onClick={() => void updateExperiment(action.status)}
            type="button"
          >
            {pendingStatus === action.status ? "Updating..." : action.label}
          </button>
        ))}
      </div>
      {message ? <p className="form-status">{message}</p> : null}
    </div>
  );
}

function actionsForStatus(status: Experiment["status"]): Action[] {
  switch (status) {
    case "draft":
      return [{ label: "Opt in and start", status: "running", style: "primary" }];
    case "running":
      return [
        { label: "Pause", status: "draft", style: "secondary" },
        { label: "Conclude", status: "concluded", style: "secondary" },
        { label: "Rollback", status: "rolled_back", style: "secondary" }
      ];
    case "concluded":
      return [
        { label: "Restart", status: "running", style: "primary" },
        { label: "Rollback", status: "rolled_back", style: "secondary" }
      ];
    case "rolled_back":
      return [{ label: "Restart", status: "running", style: "primary" }];
  }
}

function statusMessage(status: Experiment["status"], phase: "pending" | "done") {
  const labels = {
    running: ["Starting", "started"],
    draft: ["Pausing", "paused"],
    concluded: ["Concluding", "concluded"],
    rolled_back: ["Rolling back", "rolled back"]
  } satisfies Record<Experiment["status"], [string, string]>;
  return phase === "pending" ? `${labels[status][0]} experiment...` : `Experiment ${labels[status][1]}.`;
}
