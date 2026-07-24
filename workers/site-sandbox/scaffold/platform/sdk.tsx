import React, { createContext, useContext, type ReactNode } from "react";
import {
  formatLocalAddress,
  formatPhoneForDisplay,
  orderedLocationHours,
  summarizedLocationHours
} from "./presentation";

type PublicInput = {
  siteId: string;
  publicFacts: Array<{ id: string; kind: string; label: string; value: unknown }>;
  business: {
    name: string;
    identityStatus: "verified" | "provisional";
    assets: Array<{ assetId: string; alt: string }>;
    links: Array<{ id: string; url: string }>;
    locations: Array<{ id: string; label: string; street?: string; city?: string; region?: string; postalCode?: string; country?: string; hours?: Record<string, string>; sourceFactIds?: string[] }>;
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

export function BusinessName({ as: Tag = "span", className }: { as?: keyof React.JSX.IntrinsicElements; className?: string }) {
  const input = useInput();
  const fact = input.business.identityStatus === "verified"
    ? input.publicFacts.find((item) => item.kind === "business_name" && displayValue(item.value) === input.business.name)
    : undefined;
  return <Tag
    className={className}
    data-lodesta-business-name=""
    data-lodesta-identity-status={input.business.identityStatus}
    {...(fact ? { "data-lodesta-fact-id": fact.id } : {})}
  >{input.business.name}</Tag>;
}

export function Asset({
  id,
  className,
  alt,
  loading = "lazy",
  fetchPriority
}: {
  id: string;
  className?: string;
  alt?: string;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
}) {
  const asset = useInput().business.assets.find((item) => item.assetId === id);
  if (!asset) throw new Error(`Unknown eligible asset ${id}.`);
  return <img className={className} src={`asset://${id}`} alt={alt ?? asset.alt} loading={loading} fetchPriority={fetchPriority} />;
}

export function BusinessHours({
  locationId,
  variant = "summary",
  className
}: {
  locationId: string;
  variant?: "summary" | "weekly";
  className?: string;
}) {
  const input = useInput();
  const location = input.business.locations.find((item) => item.id === locationId);
  if (!location) throw new Error(`Unknown location ${locationId}.`);
  const fact = input.publicFacts.find((item) => item.kind === "hours" && location.sourceFactIds?.includes(item.id));
  const hours = orderedLocationHours(location.hours);
  if (!fact || !hours.length) return null;
  if (variant === "summary") {
    return <span
      className={className}
      data-lodesta-business-hours=""
      data-lodesta-hours-variant="summary"
      data-lodesta-fact-id={fact.id}
    >{summarizedLocationHours(location.hours)}</span>;
  }
  return <dl
    className={className}
    data-lodesta-business-hours=""
    data-lodesta-hours-variant="weekly"
    data-lodesta-fact-id={fact.id}
  >{hours.map((item) => <div key={item.key}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>;
}

export function BusinessAddress({
  locationId,
  variant = "local",
  as: Tag = "address",
  className
}: {
  locationId: string;
  variant?: "local";
  as?: "address" | "p" | "span";
  className?: string;
}) {
  const input = useInput();
  const location = input.business.locations.find((item) => item.id === locationId);
  if (!location) throw new Error(`Unknown location ${locationId}.`);
  const fact = input.publicFacts.find((item) => item.kind === "address" && location.sourceFactIds?.includes(item.id));
  if (!fact) return null;
  return <Tag
    className={className}
    data-lodesta-business-address=""
    data-lodesta-address-variant={variant}
    data-lodesta-fact-id={fact.id}
  >{formatLocalAddress(location)}</Tag>;
}

type ManagedFormDefinition = PublicInput["forms"][number];
const FormContext = createContext<ManagedFormDefinition | null>(null);

export function ManagedForm({ id, className, children }: { id: string; className?: string; children?: ReactNode }) {
  const form = useInput().forms.find((item) => item.id === id);
  if (!form) throw new Error(`Unknown form ${id}.`);
  return <form className={className} data-lodesta-form-id={id} data-lodesta-success-message={form.successMessage}>
    <FormContext.Provider value={form}>
      {children ?? <>
        {form.fields.map((field) => <ManagedField key={field.id} id={field.id} />)}
        <ManagedSubmit />
      </>}
    </FormContext.Provider>
    <p data-lodesta-form-status aria-live="polite" aria-atomic="true" />
  </form>;
}

export function ManagedField({
  id,
  className,
  labelClassName,
  controlClassName,
  label,
  placeholder,
  rows
}: {
  id: string;
  className?: string;
  labelClassName?: string;
  controlClassName?: string;
  label?: string;
  placeholder?: string;
  rows?: number;
}) {
  const form = useContext(FormContext);
  if (!form) throw new Error("ManagedField must be rendered inside ManagedForm.");
  const field = form.fields.find((item) => item.id === id);
  if (!field) throw new Error(`Unknown managed field ${id} for form ${form.id}.`);
  const controlId = `${form.id}-${field.id}`;
  const common = {
    id: controlId,
    name: field.id,
    className: controlClassName,
    required: field.required,
    placeholder,
    "data-lodesta-field-id": field.id
  };
  return <div className={className} data-lodesta-managed-field={field.id}>
    <label className={labelClassName} htmlFor={controlId}>{label ?? field.label}</label>
    {field.type === "textarea"
      ? <textarea {...common} rows={rows} />
      : field.type === "select"
        ? <select {...common}>{field.options?.map((option) => <option key={option} value={option}>{option}</option>)}</select>
        : <input {...common} type={field.type === "phone" ? "tel" : field.type} />}
  </div>;
}

export function ManagedSubmit({ className, children }: { className?: string; children?: ReactNode }) {
  const form = useContext(FormContext);
  if (!form) throw new Error("ManagedSubmit must be rendered inside ManagedForm.");
  return <button className={className} type="submit" data-lodesta-form-submit>{children ?? form.submitLabel}</button>;
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
  const query = address || location.label;
  const href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  const addressFact = input.publicFacts.find((fact) => fact.kind === "address" && location.sourceFactIds?.includes(fact.id));
  const hoursFact = input.publicFacts.find((fact) => fact.kind === "hours" && location.sourceFactIds?.includes(fact.id));
  return <section className={className} data-lodesta-map={locationId}>
    <div data-lodesta-map-surface aria-label={`Location details for ${location.label}`}>
      <div data-lodesta-location-heading><span data-lodesta-location-verified>Verified location</span><strong data-lodesta-location-name>{location.label}</strong></div>
      {addressFact ? <div data-lodesta-location-address><BusinessAddress locationId={locationId} /></div> : null}
      {hoursFact ? <div data-lodesta-location-hours><BusinessHours locationId={locationId} variant="weekly" /></div> : null}
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
  if (fact.kind === "hours" && fact.value && typeof fact.value === "object" && !Array.isArray(fact.value)) {
    return orderedLocationHours(fact.value as Record<string, string>)
      .map((item) => `${item.label}: ${item.value}`)
      .join(", ");
  }
  return displayValue(fact.value);
}

function displayValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).filter(Boolean).map(displayValue).join(", ");
  return "";
}
