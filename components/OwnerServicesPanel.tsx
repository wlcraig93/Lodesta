"use client";

import { useCallback, useEffect, useState } from "react";

type OwnerService = {
  id: string;
  name: string;
  status: "proposed" | "active" | "hidden" | "rejected";
  confirmationSource?: string;
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
    const response = await fetch(`/api/business-services?siteId=${encodeURIComponent(siteId)}`);
    const result = (await response.json()) as { ok?: boolean; services?: OwnerService[]; error?: string };
    if (!response.ok || !result.ok) {
      setStatus(result.error ?? "Unable to load services.");
      return;
    }
    setServices(result.services ?? []);
    setStatus(result.services?.length ? "" : "No services found yet — they appear after your site is generated.");
  }, [siteId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(serviceId: string, decision: "active" | "rejected") {
    setStatus("Saving…");
    const response = await fetch("/api/business-services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, serviceId, status: decision })
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
                {service.status === "proposed"
                  ? service.confirmationSource === "website"
                    ? "Found on your website"
                    : "Discovered during setup"
                  : service.status === "active"
                    ? "Confirmed"
                    : "Not offered"}
              </small>
            </div>
            <div className="button-row">
              {service.status !== "active" ? (
                <button className="button primary" type="button" onClick={() => decide(service.id, "active")}>
                  We offer this
                </button>
              ) : null}
              {service.status !== "rejected" ? (
                <button className="button secondary" type="button" onClick={() => decide(service.id, "rejected")}>
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
