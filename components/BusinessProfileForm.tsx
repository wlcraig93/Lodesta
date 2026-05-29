"use client";

import { useState } from "react";
import type { BusinessProfile } from "@/lib/models";

type BusinessProfileFormProps = {
  profile: BusinessProfile;
};

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function BusinessProfileForm({ profile }: BusinessProfileFormProps) {
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
  const [services, setServices] = useState(profile.services.join(", "));
  const [serviceAreas, setServiceAreas] = useState(profile.serviceAreas.join(", "));
  const [orderingLinks, setOrderingLinks] = useState(profile.orderingLinks.join(", "));
  const [bookingLinks, setBookingLinks] = useState(profile.bookingLinks.join(", "));
  const [socialLinks, setSocialLinks] = useState(profile.socialLinks.join(", "));
  const [status, setStatus] = useState("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("Saving business facts...");
    const response = await fetch("/api/business-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteId: profile.siteId,
        phone,
        email,
        address,
        hours,
        services: splitList(services),
        serviceAreas: splitList(serviceAreas),
        orderingLinks: splitList(orderingLinks),
        bookingLinks: splitList(bookingLinks),
        socialLinks: splitList(socialLinks)
      })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      setStatus(result.error ?? "Unable to save business facts.");
      return;
    }
    setStatus("Business facts saved and marked owner-verified.");
  }

  return (
    <form className="editor-form" onSubmit={onSubmit}>
      <label>
        <span>Phone</span>
        <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+15551234567" />
      </label>
      <label>
        <span>Email</span>
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="owner@example.com" />
      </label>

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

      <div className="form-grid-two">
        {days.map((day) => (
          <label key={day}>
            <span>{day}</span>
            <input value={hours[day] ?? ""} onChange={(event) => setHours({ ...hours, [day]: event.target.value })} />
          </label>
        ))}
      </div>

      <label>
        <span>Services</span>
        <textarea value={services} onChange={(event) => setServices(event.target.value)} />
      </label>
      <label>
        <span>Service areas</span>
        <textarea value={serviceAreas} onChange={(event) => setServiceAreas(event.target.value)} />
      </label>
      <label>
        <span>Ordering links</span>
        <textarea value={orderingLinks} onChange={(event) => setOrderingLinks(event.target.value)} />
      </label>
      <label>
        <span>Booking links</span>
        <textarea value={bookingLinks} onChange={(event) => setBookingLinks(event.target.value)} />
      </label>
      <label>
        <span>Social links</span>
        <textarea value={socialLinks} onChange={(event) => setSocialLinks(event.target.value)} />
      </label>

      <button className="button primary" type="submit">
        Save business facts
      </button>
      {status ? <p className="form-status">{status}</p> : null}
    </form>
  );
}

function splitList(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
