"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BusinessProfile, FieldProvenance } from "@/lib/models";

type FactCardId = "phone" | "email" | "address" | "hours" | "serviceAreas" | "proof" | "links";

type ProfileSnapshot = {
  siteId: string;
  phone?: string;
  email?: string;
  address?: BusinessProfile["address"];
  hours?: Record<string, string>;
  serviceAreas: string[];
  credentials: string[];
  offers: string[];
  bookingLinks: string[];
  orderingLinks: string[];
  socialLinks: string[];
  pressLinks: string[];
  provenance: Record<string, FieldProvenance>;
};

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function OwnerFactsReview({
  profile
}: {
  profile: ProfileSnapshot;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<FactCardId | null>(null);
  const [busy, setBusy] = useState<FactCardId | null>(null);
  const [error, setError] = useState<{ card: FactCardId; message: string } | null>(null);

  const [phone, setPhone] = useState(profile.phone ?? "");
  const [email, setEmail] = useState(profile.email ?? "");
  const [address, setAddress] = useState({
    street: profile.address?.street ?? "",
    city: profile.address?.city ?? "",
    region: profile.address?.region ?? "",
    postalCode: profile.address?.postalCode ?? "",
    country: profile.address?.country ?? "US"
  });
  const [hours, setHours] = useState<Record<string, string>>(
    Object.fromEntries(days.map((day) => [day, profile.hours?.[day] ?? ""]))
  );
  const [serviceAreas, setServiceAreas] = useState(profile.serviceAreas.join(", "));
  const [credentials, setCredentials] = useState(profile.credentials.join(", "));
  const [offers, setOffers] = useState(profile.offers.join(", "));
  const [bookingLinks, setBookingLinks] = useState(profile.bookingLinks.join(", "));
  const [orderingLinks, setOrderingLinks] = useState(profile.orderingLinks.join(", "));
  const [socialLinks, setSocialLinks] = useState(profile.socialLinks.join(", "));
  const [pressLinks, setPressLinks] = useState(profile.pressLinks.join(", "));

  async function save(card: FactCardId, payloads: Array<Record<string, unknown>>) {
    setBusy(card);
    setError(null);
    try {
      for (const payload of payloads) {
        const response = await fetch("/api/control-plane/changes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ siteId: profile.siteId, payload })
        });
        const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!response.ok || !result.ok) {
          setError({ card, message: result.error ?? "We couldn't save that. Try again." });
          return;
        }
      }
      setEditing(null);
      router.refresh();
    } catch (saveError) {
      setError({ card, message: saveError instanceof Error ? saveError.message : "We couldn't save that. Try again." });
    } finally {
      setBusy(null);
    }
  }

  function payloadFor(card: FactCardId): Array<Record<string, unknown>> {
    if (card === "phone") return [{ kind: "set_contact", phone }];
    if (card === "email") return [{ kind: "set_contact", email }];
    if (card === "address") return [{ kind: "set_location", address }];
    if (card === "hours") return [{ kind: "set_hours", hours: cleanHours(hours) }];
    if (card === "serviceAreas") return [{ kind: "set_location", serviceAreas: splitList(serviceAreas) }];
    if (card === "proof") {
      return [
        ...splitList(credentials).map((publicText) => ({ kind: "register_proof", proofKind: "credential", publicText })),
        ...splitList(offers).map((publicText) => ({ kind: "register_proof", proofKind: "offer", publicText }))
      ];
    }
    return linkChanges("booking", profile.bookingLinks, splitList(bookingLinks))
      .concat(linkChanges("ordering", profile.orderingLinks, splitList(orderingLinks)))
      .concat(linkChanges("social", profile.socialLinks, splitList(socialLinks)))
      .concat(linkChanges("press", profile.pressLinks, splitList(pressLinks)));
  }

  function factCard(input: {
    card: FactCardId;
    label: string;
    provenanceKey: string;
    hasValue: boolean;
    display: React.ReactNode;
    editor: React.ReactNode;
  }) {
    const provenance = profile.provenance[input.provenanceKey];
    const isEditing = editing === input.card;
    const isBusy = busy === input.card;
    const cardError = error?.card === input.card ? error.message : null;

    return (
      <article className="owner-fact-card" key={input.card}>
        <div className="owner-fact-card-head">
          <h3>{input.label}</h3>
          <ProvenanceBadge provenance={provenance} hasValue={input.hasValue} />
        </div>
        {isEditing ? (
          <div className="owner-fact-editor">
            {input.editor}
            <div className="owner-fact-actions">
              <button
                className="button primary"
                type="button"
                disabled={isBusy}
                onClick={() => void save(input.card, payloadFor(input.card))}
              >
                {isBusy ? "Saving..." : "Save"}
              </button>
              <button className="button secondary" type="button" disabled={isBusy} onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="owner-fact-value">{input.hasValue ? input.display : <span className="muted">Not on file yet</span>}</div>
            <div className="owner-fact-actions">
              {input.hasValue && !provenance?.verified ? (
                <button
                  className="button primary"
                  type="button"
                  disabled={isBusy}
                  onClick={() => void save(input.card, payloadFor(input.card))}
                >
                  {isBusy ? "Saving..." : "This is correct"}
                </button>
              ) : null}
              <button className="button secondary" type="button" disabled={isBusy} onClick={() => setEditing(input.card)}>
                {input.hasValue ? "Edit" : "Add"}
              </button>
            </div>
          </>
        )}
        {cardError ? <p className="form-status error-text">{cardError}</p> : null}
      </article>
    );
  }

  return (
    <div className="owner-fact-grid">
      {factCard({
        card: "phone",
        label: "Phone",
        provenanceKey: "phone",
        hasValue: Boolean(profile.phone),
        display: <strong>{profile.phone}</strong>,
        editor: (
          <label>
            <span>Phone number</span>
            <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+15551234567" />
          </label>
        )
      })}
      {factCard({
        card: "proof",
        label: "Proof and offers",
        provenanceKey: profile.credentials.length ? "credentials" : "offers",
        hasValue: profile.credentials.length + profile.offers.length > 0,
        display: (
          <ul className="owner-fact-links">
            {profile.credentials.length ? <li>Credentials: {profile.credentials.join(", ")}</li> : null}
            {profile.offers.length ? <li>Offers: {profile.offers.join(", ")}</li> : null}
          </ul>
        ),
        editor: (
          <>
            <label>
              <span>Credentials, licenses, or certifications</span>
              <textarea value={credentials} onChange={(event) => setCredentials(event.target.value)} />
            </label>
            <label>
              <span>Offers or specials</span>
              <textarea value={offers} onChange={(event) => setOffers(event.target.value)} />
            </label>
          </>
        )
      })}
      {factCard({
        card: "email",
        label: "Email",
        provenanceKey: "email",
        hasValue: Boolean(profile.email),
        display: <strong>{profile.email}</strong>,
        editor: (
          <label>
            <span>Email address</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="owner@example.com" />
          </label>
        )
      })}
      {factCard({
        card: "address",
        label: "Address",
        provenanceKey: "address",
        hasValue: Boolean(
          profile.address?.street || profile.address?.city || profile.address?.region || profile.address?.postalCode
        ),
        display: (
          <strong>
            {[profile.address?.street, profile.address?.city, profile.address?.region, profile.address?.postalCode]
              .filter(Boolean)
              .join(", ")}
          </strong>
        ),
        editor: (
          <div className="form-grid-two">
            <label>
              <span>Street</span>
              <input value={address.street} onChange={(event) => setAddress({ ...address, street: event.target.value })} />
            </label>
            <label>
              <span>City</span>
              <input value={address.city} onChange={(event) => setAddress({ ...address, city: event.target.value })} />
            </label>
            <label>
              <span>State/region</span>
              <input value={address.region} onChange={(event) => setAddress({ ...address, region: event.target.value })} />
            </label>
            <label>
              <span>Postal code</span>
              <input value={address.postalCode} onChange={(event) => setAddress({ ...address, postalCode: event.target.value })} />
            </label>
          </div>
        )
      })}
      {factCard({
        card: "hours",
        label: "Hours",
        provenanceKey: "hours",
        hasValue: Boolean(profile.hours && Object.keys(profile.hours).length > 0),
        display: (
          <ul className="owner-fact-hours">
            {Object.entries(profile.hours ?? {}).map(([day, value]) => (
              <li key={day}>
                <span>{day}</span>
                <strong>{value}</strong>
              </li>
            ))}
          </ul>
        ),
        editor: (
          <div className="form-grid-two">
            {days.map((day) => (
              <label key={day}>
                <span>{day}</span>
                <input
                  value={hours[day] ?? ""}
                  placeholder="9am - 5pm"
                  onChange={(event) => setHours({ ...hours, [day]: event.target.value })}
                />
              </label>
            ))}
          </div>
        )
      })}
      {factCard({
        card: "serviceAreas",
        label: "Service areas",
        provenanceKey: "serviceAreas",
        hasValue: profile.serviceAreas.length > 0,
        display: <strong>{profile.serviceAreas.join(", ")}</strong>,
        editor: (
          <label>
            <span>Areas you serve (comma separated)</span>
            <textarea value={serviceAreas} onChange={(event) => setServiceAreas(event.target.value)} />
          </label>
        )
      })}
      {factCard({
        card: "links",
        label: "Links",
        provenanceKey: "bookingLinks",
        hasValue:
          profile.bookingLinks.length + profile.orderingLinks.length + profile.socialLinks.length + profile.pressLinks.length > 0,
        display: (
          <ul className="owner-fact-links">
            {profile.bookingLinks.length ? <li>Booking: {profile.bookingLinks.join(", ")}</li> : null}
            {profile.orderingLinks.length ? <li>Ordering: {profile.orderingLinks.join(", ")}</li> : null}
            {profile.socialLinks.length ? <li>Social: {profile.socialLinks.join(", ")}</li> : null}
            {profile.pressLinks.length ? <li>Press: {profile.pressLinks.join(", ")}</li> : null}
          </ul>
        ),
        editor: (
          <>
            <label>
              <span>Booking links</span>
              <textarea value={bookingLinks} onChange={(event) => setBookingLinks(event.target.value)} />
            </label>
            <label>
              <span>Ordering links</span>
              <textarea value={orderingLinks} onChange={(event) => setOrderingLinks(event.target.value)} />
            </label>
            <label>
              <span>Social links</span>
              <textarea value={socialLinks} onChange={(event) => setSocialLinks(event.target.value)} />
            </label>
            <label>
              <span>Press and video links</span>
              <textarea value={pressLinks} onChange={(event) => setPressLinks(event.target.value)} />
            </label>
          </>
        )
      })}
    </div>
  );
}

function ProvenanceBadge({ provenance, hasValue }: { provenance: FieldProvenance | undefined; hasValue: boolean }) {
  if (!hasValue) return <span className="badge">missing</span>;
  if (provenance?.verified) return <span className="badge status-ready">Confirmed by you</span>;
  if (provenance?.source === "website") return <span className="badge status-pending">Found on your website</span>;
  if (provenance?.source === "google" || provenance?.source === "places_api")
    return <span className="badge status-pending">Found on Google</span>;
  return <span className="badge status-pending">Added during setup</span>;
}

function splitList(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanHours(hours: Record<string, string>) {
  return Object.fromEntries(Object.entries(hours).filter(([, value]) => value.trim()).map(([day, value]) => [day, value.trim()]));
}

function linkChanges(linkType: "booking" | "ordering" | "social" | "press", previous: string[], next: string[]) {
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  return [
    ...next.filter((url) => !previousSet.has(url)).map((url) => ({ kind: "set_external_link", linkType, url, enabled: true })),
    ...previous.filter((url) => !nextSet.has(url)).map((url) => ({ kind: "set_external_link", linkType, url, enabled: false }))
  ];
}
