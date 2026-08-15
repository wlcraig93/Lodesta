import React, { createContext, useContext, type ReactNode } from "react";
import {
  formatLocalAddress,
  directionsHrefForLocation,
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
  forms: Array<{
    id: string;
    key: string;
    revision: number;
    destination: "lead_inbox";
    fields: Array<{
      id: string;
      label: string;
      role: "contact_name" | "contact_email" | "contact_phone" | "message" | "custom";
      type: "text" | "email" | "phone" | "textarea" | "select" | "radio" | "checkbox";
      required: boolean;
      options?: string[];
      placeholder?: string;
      helpText?: string;
    }>;
    submitLabel: string;
    successMessage: string;
  }>;
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
    data-lodesta-location-id={locationId}
  >{formatLocalAddress(location)}</Tag>;
}

type LeadFormDefinition = PublicInput["forms"][number];
type LeadFormFieldDefinition = LeadFormDefinition["fields"][number];
const LeadFormContext = createContext<LeadFormDefinition | null>(null);

export function LeadForm({ id, className, children }: { id: string; className?: string; children?: ReactNode }) {
  const form = useInput().forms.find((item) => item.id === id);
  if (!form) throw new Error(`Unknown form ${id}.`);
  return <form
    className={className}
    data-lodesta-form-id={id}
    data-lodesta-form-key={form.key}
    data-lodesta-form-revision={form.revision}
    data-lodesta-form-destination={form.destination}
    data-lodesta-success-message={form.successMessage}
  >
    <LeadFormContext.Provider value={form}>
      {children ?? <>
        {form.fields.map((field) => <LeadField key={field.id} id={field.id} />)}
        <LeadSubmit />
        <LeadFormStatus />
      </>}
    </LeadFormContext.Provider>
  </form>;
}

export function LeadField({
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
  const { form, field } = useLeadField(id);
  const controlId = `${form.id}-${field.id}`;
  return <div className={className} data-lodesta-lead-field={field.id}>
    <LeadLabel id={id} className={labelClassName}>{label}</LeadLabel>
    <LeadControl id={id} className={controlClassName} placeholder={placeholder} rows={rows} controlId={controlId} />
    {field.helpText ? <small>{field.helpText}</small> : null}
  </div>;
}

export function LeadLabel({ id, className, children }: { id: string; className?: string; children?: ReactNode }) {
  const { form, field } = useLeadField(id);
  if (field.type === "radio") return <span className={className} id={`${form.id}-${field.id}-label`}>{children ?? field.label}</span>;
  return <label className={className} htmlFor={`${form.id}-${field.id}`}>{children ?? field.label}</label>;
}

export function LeadControl({
  id,
  className,
  placeholder,
  rows,
  controlId
}: {
  id: string;
  className?: string;
  placeholder?: string;
  rows?: number;
  controlId?: string;
}) {
  const { form, field } = useLeadField(id);
  const resolvedId = controlId ?? `${form.id}-${field.id}`;
  const common = {
    id: resolvedId,
    name: field.id,
    className,
    required: field.required,
    placeholder: placeholder ?? field.placeholder,
    autoComplete: leadFieldAutocomplete(field.role),
    "data-lodesta-field-id": field.id,
    "data-lodesta-field-role": field.role
  };
  if (field.type === "textarea") return <textarea {...common} rows={rows} />;
  if (field.type === "select") {
    return <select {...common}>
      <option value="">Select an option</option>
      {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>;
  }
  if (field.type === "radio") {
    return <fieldset
      className={className}
      aria-labelledby={`${form.id}-${field.id}-label`}
      data-lodesta-field-id={field.id}
      data-lodesta-field-role={field.role}
    >
      {field.options?.map((option, index) => {
        const optionId = `${resolvedId}-${stableId(option)}`;
        return <label key={option} htmlFor={optionId}>
          <input id={optionId} name={field.id} type="radio" value={option} required={field.required && index === 0} />
          <span>{option}</span>
        </label>;
      })}
    </fieldset>;
  }
  return <input {...common} type={field.type === "phone" ? "tel" : field.type} value={field.type === "checkbox" ? "true" : undefined} />;
}

export function leadFieldAutocomplete(role: PublicInput["forms"][number]["fields"][number]["role"]) {
  if (role === "contact_name") return "name";
  if (role === "contact_email") return "email";
  if (role === "contact_phone") return "tel";
  return undefined;
}

export function LeadSubmit({ className, children }: { className?: string; children?: ReactNode }) {
  const form = useContext(LeadFormContext);
  if (!form) throw new Error("LeadSubmit must be rendered inside LeadForm.");
  return <button className={className} type="submit" data-lodesta-form-submit>{children ?? form.submitLabel}</button>;
}

export function LeadFormStatus({ className }: { className?: string }) {
  return <p className={className} data-lodesta-form-status aria-live="polite" aria-atomic="true" />;
}

function useLeadField(id: string): { form: LeadFormDefinition; field: LeadFormFieldDefinition } {
  const form = useContext(LeadFormContext);
  if (!form) throw new Error("Lead form fields must be rendered inside LeadForm.");
  const field = form.fields.find((item) => item.id === id);
  if (!field) throw new Error(`Unknown lead field ${id} for form ${form.id}.`);
  return { form, field };
}

export function SafeLink({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  const link = useInput().business.links.find((item) => item.id === id);
  if (!link) throw new Error(`Unknown eligible link ${id}.`);
  return <a href={link.url} className={className}>{children}</a>;
}

export function DirectionsLink({
  locationId,
  className,
  target = "_blank",
  children
}: {
  locationId: string;
  className?: string;
  target?: "_self" | "_blank";
  children: ReactNode;
}) {
  const input = useInput();
  const location = input.business.locations.find((item) => item.id === locationId);
  if (!location) throw new Error(`Unknown location ${locationId}.`);
  const href = directionsHrefForLocation(location);
  return <a
    href={href}
    className={className}
    target={target}
    rel={target === "_blank" ? "noopener noreferrer" : undefined}
    data-lodesta-directions=""
    data-lodesta-location-id={locationId}
  >{children}</a>;
}

export function NavigationDisclosure({
  id,
  label = "Primary",
  behavior,
  openLabel = "Open navigation",
  closeLabel = "Close navigation",
  className,
  toggleClassName,
  panelClassName,
  navClassName,
  trigger,
  children
}: {
  id: string;
  label?: string;
  behavior: "modal" | "inline";
  openLabel?: string;
  closeLabel?: string;
  className?: string;
  toggleClassName?: string;
  panelClassName?: string;
  navClassName?: string;
  trigger?: ReactNode;
  children: ReactNode;
}) {
  return <div
    className={className}
    data-lodesta-navigation-disclosure={id}
    data-lodesta-navigation-behavior={behavior}
  >
    <button
      type="button"
      className={toggleClassName}
      aria-controls={id}
      aria-expanded="false"
      aria-label={openLabel}
      aria-haspopup={behavior === "modal" ? "dialog" : undefined}
      data-lodesta-menu-toggle=""
      data-lodesta-open-label={openLabel}
      data-lodesta-close-label={closeLabel}
    >
      {trigger ?? <span data-lodesta-navigation-icon="" aria-hidden="true"><span /><span /><span /></span>}
    </button>
    <div
      id={id}
      className={panelClassName}
      role={behavior === "modal" ? "dialog" : undefined}
      aria-modal={behavior === "modal" ? "true" : undefined}
      aria-label={behavior === "modal" ? label : undefined}
      tabIndex={-1}
      hidden
      data-lodesta-menu=""
      data-lodesta-navigation-panel=""
    >
      <nav className={navClassName} aria-label={label}>{children}</nav>
    </div>
  </div>;
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
