"use client";

import { useCallback, useEffect, useState } from "react";

type OwnerService = {
  id: string;
  name: string;
  status: "observed" | "confirmed" | "rejected" | "inactive";
  featured: boolean;
};

/**
 * "We found these services — confirm what you actually offer." Proposed rows
 * come from intake (website/web-search evidence mapped to the catalog);
 * confirming converts them to owner-attested truth.
 */
export function OwnerServicesPanel({ siteId }: { siteId: string }) {
  const [services, setServices] = useState<OwnerService[]>([]);
  const [status, setStatus] = useState("Loading services…");

  const load = useCallback(async () => {
    const response = await fetch(`/api/control-plane/changes?siteId=${encodeURIComponent(siteId)}`);
    const result = (await response.json()) as {
      ok?: boolean;
      controlPlane?: { state?: { offerings?: Array<OwnerService & { catalogId?: string; customName?: string }> } };
      serviceCatalog?: Array<{ id: string; name: string }>;
      error?: string;
    };
    if (!response.ok || !result.ok) {
      setStatus(result.error ?? "Unable to load services.");
      return;
    }
    const names = new Map((result.serviceCatalog ?? []).map((definition) => [definition.id, definition.name]));
    const services = (result.controlPlane?.state?.offerings ?? []).map((service) => ({
      ...service,
      name: service.customName ?? names.get(service.catalogId ?? "") ?? service.catalogId ?? "Custom service"
    }));
    setServices(services);
    setStatus(services.length ? "" : "No services found yet — they appear after your site is generated.");
  }, [siteId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(serviceId: string, enabled: boolean) {
    setStatus("Saving…");
    const response = await fetch("/api/control-plane/changes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, payload: { kind: "set_offering", offeringId: serviceId, enabled } })
    });
    const result = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) {
      setStatus(result.error ?? "Unable to save.");
      return;
    }
    setStatus("Saved.");
    await load();
  }

  return (
    <section className="owner-services-panel">
      <h2>Your services</h2>
      <p>We found these on your website. Confirm what you actually offer — confirmed services drive your site&apos;s sections and pages.</p>
      <ul className="owner-services-list">
        {services.map((service) => (
          <li key={service.id} className="owner-service-row" data-status={service.status}>
            <div>
              <strong>{service.name}</strong>
              <small>
                {service.status === "observed"
                  ? "Found during setup"
                  : service.status === "confirmed"
                    ? "Confirmed"
                    : "Not offered"}
              </small>
            </div>
            <div className="button-row">
              {service.status !== "confirmed" ? (
                <button className="button primary" type="button" onClick={() => decide(service.id, true)}>
                  We offer this
                </button>
              ) : null}
              {service.status !== "inactive" ? (
                <button className="button secondary" type="button" onClick={() => decide(service.id, false)}>
                  Not offered
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {status ? <p className="form-status">{status}</p> : null}
    </section>
  );
}
