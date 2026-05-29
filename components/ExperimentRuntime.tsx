"use client";

import { useEffect } from "react";

type ExperimentRuntimeProps = {
  siteId: string;
};

const sessionKey = "lodesta_session_id";

declare global {
  interface Window {
    __lodestaSessionId?: string;
  }
}

export function ExperimentRuntime({ siteId }: ExperimentRuntimeProps) {
  useEffect(() => {
    const sessionId = getSessionId();
    void fetch("/api/experiments/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, sessionId })
    })
      .then((response) => response.json())
      .then((assignment) => {
        if (!assignment.assigned) return;
        const variantId = String(assignment.variant?.id ?? "unknown");
        if (assignment.experimentId && variantId) {
          document.documentElement.dataset.stickyCtaVariant = variantId;
          sendExperimentAssignment(siteId, sessionId, assignment.experimentId, variantId, assignment.primaryMetric, Boolean(assignment.holdout));
        }
      })
      .catch(() => {
        // Experiment assignment is non-critical for rendering.
      });
  }, [siteId]);

  return null;
}

function sendExperimentAssignment(
  siteId: string,
  sessionId: string,
  experimentId: string,
  variantId: string,
  primaryMetric?: string,
  holdout = false
) {
  const payload = JSON.stringify({
    siteId,
    sessionId,
    eventType: "experiment_assignment",
    timestamp: new Date().toISOString(),
    metadata: {
      experimentId,
      variantId,
      primaryMetric: primaryMetric ?? "",
      holdout
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
