"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Experiment } from "@/lib/models";

type ExperimentControlFormProps = {
  siteId: string;
  experimentId: string;
  status: Experiment["status"];
  holdoutPercent?: number;
};

type Action = {
  label: string;
  status: Experiment["status"];
  style: "primary" | "secondary";
};

export function ExperimentControlForm({ siteId, experimentId, status, holdoutPercent }: ExperimentControlFormProps) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pendingStatus, setPendingStatus] = useState<Experiment["status"] | null>(null);
  const [pendingHoldout, setPendingHoldout] = useState(false);
  const [holdoutValue, setHoldoutValue] = useState(Math.round((holdoutPercent ?? 0.1) * 100));
  const actions = actionsForStatus(status);

  async function updateExperiment(nextStatus: Experiment["status"]) {
    setPendingStatus(nextStatus);
    setMessage(statusMessage(nextStatus, "pending"));
    const response = await fetch("/api/experiments/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, experimentId, status: nextStatus, holdoutPercent: holdoutValue / 100 })
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

  async function updateHoldout() {
    setPendingHoldout(true);
    setMessage("Saving holdout...");
    const response = await fetch("/api/experiments/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, experimentId, status, holdoutPercent: holdoutValue / 100 })
    });
    const result = await response.json();
    setPendingHoldout(false);
    if (!response.ok || !result.ok) {
      setMessage(result.error ?? "Unable to save holdout.");
      return;
    }
    setMessage(`Holdout saved at ${holdoutValue}%.`);
    router.refresh();
  }

  return (
    <div className="experiment-controls">
      <label className="form-field">
        <span>Control holdout</span>
        <input
          max="50"
          min="0"
          onChange={(event) => setHoldoutValue(Number(event.target.value))}
          step="5"
          type="range"
          value={holdoutValue}
        />
        <span className="muted">{holdoutValue}%</span>
      </label>
      <div className="button-row">
        <button className="button secondary" disabled={pendingHoldout || Boolean(pendingStatus)} onClick={() => void updateHoldout()} type="button">
          {pendingHoldout ? "Saving..." : "Save holdout"}
        </button>
        {actions.map((action) => (
          <button
            className={`button ${action.style}`}
            disabled={Boolean(pendingStatus) || pendingHoldout}
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
