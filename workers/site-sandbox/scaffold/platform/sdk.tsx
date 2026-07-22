import React, { createContext, useContext, type ReactNode } from "react";
import { formatPhoneForDisplay, orderedLocationHours } from "./presentation";

type PublicInput = {
  siteId: string;
  publicFacts: Array<{ id: string; kind: string; label: string; value: unknown }>;
  business: {
    assets: Array<{ assetId: string; alt: string }>;
    links: Array<{ id: string; url: string }>;
    locations: Array<{ id: string; label: string; street?: string; city?: string; region?: string; postalCode?: string; googlePlaceId?: string; hours?: Record<string, string>; sourceFactIds?: string[] }>;
  };
  forms: Array<{ id: string; fields: Array<{ id: string; label: string; type: string; required: boolean; options?: string[] }>; submitLabel: string; successMessage: string }>;
};

const InputContext = createContext<PublicInput | null>(null);
export function LodestaSite({ input, children }: { input: PublicInput; children: ReactNode }) {
  return <InputContext.Provider value={input}>{children}</InputContext.Provider>;
}
function useInput() { const input = useContext(InputContext); if (!input) throw new Error("LodestaSite context is missing."); return input; }

export function Fact({ id, as: Tag = "span", className }: { id: string; as?: keyof React.JSX.IntrinsicElements; className?: string }) {
  const fact = useInput().publicFacts.find((item) => item.id === id);
  if (!fact) throw new Error(`Unknown public fact ${id}.`);
  return <Tag className={className} data-lodesta-fact-id={id}>{displayFactValue(fact)}</Tag>;
}

export function Asset({ id, className, alt }: { id: string; className?: string; alt?: string }) {
  const asset = useInput().business.assets.find((item) => item.assetId === id);
  if (!asset) throw new Error(`Unknown eligible asset ${id}.`);
  return <img className={className} src={`asset://${id}`} alt={alt ?? asset.alt} />;
}

export function ManagedForm({ id, className }: { id: string; className?: string }) {
  const form = useInput().forms.find((item) => item.id === id);
  if (!form) throw new Error(`Unknown form ${id}.`);
  return <form className={className} data-lodesta-form-id={id} data-lodesta-success-message={form.successMessage}>
    {form.fields.map((field) => <label key={field.id}>{field.label}{field.type === "textarea"
      ? <textarea name={field.id} required={field.required} />
      : field.type === "select"
        ? <select name={field.id} required={field.required}>{field.options?.map((option) => <option key={option}>{option}</option>)}</select>
        : <input name={field.id} type={field.type} required={field.required} />}</label>)}
    <button type="submit">{form.submitLabel}</button><p data-lodesta-form-status aria-live="polite" />
  </form>;
}

export function SafeLink({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  const link = useInput().business.links.find((item) => item.id === id);
  if (!link) throw new Error(`Unknown eligible link ${id}.`);
  return <a href={link.url} className={className}>{children}</a>;
}

export function ManagedMap({ locationId, className }: { locationId: string; className?: string }) {
  const input = useInput();
  const location = input.business.locations.find((item) => item.id === locationId);
  if (!location) throw new Error(`Unknown location ${locationId}.`);
  const address = [location.street, location.city, location.region, location.postalCode].filter(Boolean).join(", ");
  const query = location.googlePlaceId ? `place_id:${location.googlePlaceId}` : address || location.label;
  const href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  const addressFact = input.publicFacts.find((fact) => fact.kind === "address" && location.sourceFactIds?.includes(fact.id));
  const hoursFact = input.publicFacts.find((fact) => fact.kind === "hours" && location.sourceFactIds?.includes(fact.id));
  const hours = orderedLocationHours(location.hours);
  return <section className={className} data-lodesta-map={locationId} data-lodesta-place-id={location.googlePlaceId}>
    <div data-lodesta-map-surface aria-label={`Location details for ${location.label}`}>
      <div data-lodesta-location-heading><span data-lodesta-location-verified>Verified location</span><strong data-lodesta-location-name>{location.label}</strong></div>
      {addressFact ? <address data-lodesta-location-address data-lodesta-fact-id={addressFact.id}>{displayValue(addressFact.value)}</address> : null}
      {hours.length ? <dl data-lodesta-location-hours {...(hoursFact ? { "data-lodesta-fact-id": hoursFact.id } : {})}>{hours.map((item) => <div key={item.key}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl> : null}
    </div>
    <a href={href} target="_blank" rel="noopener noreferrer" data-lodesta-map-fallback>Get directions</a>
  </section>;
}

export function Gallery({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return <div className={className} data-lodesta-gallery={id}><button type="button" aria-controls={id} data-lodesta-gallery-direction="previous" aria-label="Previous image">&#8592;</button><div id={id}>{children}</div><button type="button" aria-controls={id} data-lodesta-gallery-direction="next" aria-label="Next image">&#8594;</button></div>;
}

export function Disclosure({ summary, children, className }: { summary: string; children: ReactNode; className?: string }) {
  const id = `disclosure-${stableId(summary)}`;
  return <details className={className} data-lodesta-disclosure={id}><summary>{summary}</summary>{children}</details>;
}

function stableId(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "item"; }

function displayFactValue(fact: PublicInput["publicFacts"][number]) {
  if (fact.kind === "phone" && typeof fact.value === "string") return formatPhoneForDisplay(fact.value);
  return displayValue(fact.value);
}

function displayValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).filter(Boolean).map(displayValue).join(", ");
  return "";
}
