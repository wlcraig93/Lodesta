"use client";

import { useEffect } from "react";
import type { Experiment } from "@/lib/models";

type ExperimentRuntimeProps = {
  siteId: string;
  experiments?: Experiment[];
};

const sessionKey = "lodesta_session_id";
const surfaceDatasetKeys: Record<Experiment["surface"], string> = {
  sticky_cta: "stickyCtaVariant",
  cta_placement: "ctaPlacementVariant",
  form_length: "formLengthVariant",
  hero_layout: "heroLayoutVariant"
};

declare global {
  interface Window {
    __lodestaSessionId?: string;
  }
}

export function ExperimentRuntime({ siteId, experiments = [] }: ExperimentRuntimeProps) {
  useEffect(() => {
    const sessionId = getSessionId();
    const runningExperiments = experiments.filter((experiment) => experiment.status === "running");
    const targets = runningExperiments.length ? runningExperiments : [undefined];

    for (const experiment of targets) {
      void fetch("/api/experiments/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, sessionId, experimentId: experiment?.id })
      })
        .then((response) => response.json())
        .then((assignment) => {
          if (!assignment.assigned) return;
          const surface = surfaceForAssignment(assignment.surface, experiment?.surface);
          const variantId = String(assignment.variant?.id ?? "unknown");
          if (assignment.experimentId && surface && variantId) {
            applyVariant(surface, variantId);
            sendExperimentAssignment({
              siteId,
              sessionId,
              experimentId: assignment.experimentId,
              surface,
              variantId,
              primaryMetric: assignment.primaryMetric,
              holdout: Boolean(assignment.holdout)
            });
          }
        })
        .catch(() => {
          // Experiment assignment is non-critical for rendering.
        });
    }
  }, [siteId, experiments]);

  return null;
}

function applyVariant(surface: Experiment["surface"], variantId: string) {
  document.documentElement.dataset[surfaceDatasetKeys[surface]] = variantId;
}

function surfaceForAssignment(surface: unknown, fallback?: Experiment["surface"]): Experiment["surface"] | undefined {
  if (surface === "sticky_cta" || surface === "cta_placement" || surface === "form_length" || surface === "hero_layout") {
    return surface;
  }
  return fallback;
}

function sendExperimentAssignment(input: {
  siteId: string;
  sessionId: string;
  experimentId: string;
  surface: Experiment["surface"];
  variantId: string;
  primaryMetric?: string;
  holdout: boolean;
}) {
  const payload = JSON.stringify({
    siteId: input.siteId,
    sessionId: input.sessionId,
    eventType: "experiment_assignment",
    timestamp: new Date().toISOString(),
    metadata: {
      experimentId: input.experimentId,
      surface: input.surface,
      variantId: input.variantId,
      primaryMetric: input.primaryMetric ?? "",
      holdout: input.holdout
    }
  });

  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/analytics", new Blob([payload], { type: "application/json" }));
    return;
  }

  void fetch("/api/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true
  });
}

function getSessionId() {
  if (window.__lodestaSessionId) return window.__lodestaSessionId;
  const storage = safeSessionStorage();
  const existing = storage.getItem(sessionKey);
  if (existing) {
    window.__lodestaSessionId = existing;
    return existing;
  }
  const created = crypto.randomUUID();
  storage.setItem(sessionKey, created);
  window.__lodestaSessionId = created;
  return created;
}

function safeSessionStorage() {
  try {
    if (window.sessionStorage) return window.sessionStorage;
  } catch {
    // Fall through to an in-memory fallback for restricted browser contexts.
  }
  const memory = new Map<string, string>();
  return {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    }
  };
}
