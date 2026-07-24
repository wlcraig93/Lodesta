"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { BusinessState, SiteIntent } from "@/packages/site-contracts";
import { ProductSelect } from "@/components/ProductUI";

export function BusinessDataControls({ siteId, state, intent, sourceSnapshotId }: { siteId: string; state: BusinessState; intent: SiteIntent; sourceSnapshotId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<string>();

  async function submit(key: string, payload: Record<string, unknown>) {
    setBusy(key); setNotice(undefined);
    try {
      const response = await fetch("/api/control-plane/changes", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteId, payload })
      });
      const body = await response.json().catch(() => null) as { error?: string; request?: { status?: string } } | null;
      if (!response.ok) throw new Error(body?.error ?? `Change failed (${response.status})`);
      setNotice(body?.request?.status === "pending" ? "Submitted for operator review." : "Saved. A replacement version is being prepared.");
      router.refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(undefined); }
  }

  async function uploadAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const file = values.get("assetFile");
    const kind = values.get("assetKind") === "logo" ? "logo" : "photo";
    if (!(file instanceof File) || !file.size) return setNotice("Choose an image to upload.");
    const body = new FormData();
    body.set("siteId", siteId);
    if (kind === "logo") {
      body.set("logoFile", file);
      body.set("logoAlt", String(values.get("assetAlt") ?? "") || "Business logo");
    } else {
      body.append("photoFiles", file);
      body.append("photoAlt", String(values.get("assetAlt") ?? "") || "Business photo");
    }
    setBusy("asset-upload"); setNotice(undefined);
    try {
      const response = await fetch("/api/assets/owner", { method: "POST", body });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? `Upload failed (${response.status})`);
      form.reset();
      setNotice("Asset retained. A replacement version is being prepared.");
      router.refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(undefined); }
  }

  return <div className="owner-business-layout">
    <nav className="owner-business-section-nav" aria-label="Business information sections">
      <span>Business information</span>
      <a href="#contact">Contact</a>
      <a href="#hours">Hours</a>
      <a href="#services">Services</a>
      <a href="#proof-media">Proof and media</a>
      <a href="#site-preferences">Site preferences</a>
      <label><span>Jump to section</span><ProductSelect defaultValue="" onChange={(event) => { if (event.target.value) window.location.hash = event.target.value; }}><option value="" disabled>Choose section</option><option value="contact">Contact</option><option value="hours">Hours</option><option value="services">Services</option><option value="proof-media">Proof and media</option><option value="site-preferences">Site preferences</option></ProductSelect></label>
    </nav>
    <div className="owner-authority-stack">
    {notice ? <div className="site-agent-notice" role="status">{notice}</div> : null}
    <section className="panel"><div className="section-heading-row"><div><h2>Business identity</h2><p className="muted">Confirm or correct the name used throughout the website before publishing.</p></div><span className="badge">{state.identity.status}</span></div>
      <form className="owner-authority-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void submit("identity", { kind: "confirm_identity", name: String(form.get("name") ?? "") }); }}>
        <label>Business name<input name="name" defaultValue={state.identity.name} required maxLength={200} /></label>
        <button className="button primary" type="submit" disabled={Boolean(busy)}>{busy === "identity" ? "Saving" : state.identity.status === "verified" ? "Update name" : "Confirm name"}</button>
      </form>
    </section>
    <section className="panel" id="contact"><div className="section-heading-row"><div><h2>Contact</h2><p className="muted">Confirmed changes recompile the current design without a redesign.</p></div><span className="badge">Revision {state.revision}</span></div>
      <form className="owner-authority-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void submit("contact", { kind: "update_contact", phone: String(form.get("phone") ?? "") || undefined, email: String(form.get("email") ?? "") || undefined }); }}>
        <label>Phone<input name="phone" defaultValue={state.contacts.phone ?? ""} /></label><label>Email<input name="email" type="email" defaultValue={state.contacts.email ?? ""} /></label><button className="button primary" type="submit" disabled={Boolean(busy)}>{busy === "contact" ? "Saving" : "Save contact"}</button>
      </form>
    </section>
    <section className="panel" id="hours"><div className="section-heading-row"><div><h2>Hours</h2><p className="muted">Published hours remain canonical business data across every page.</p></div><span className="badge">{state.locations.length}</span></div>
      <div className="owner-authority-list">{state.locations.map((location) => <form className="owner-hours-form" key={location.id} onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); const hours = Object.fromEntries(weekdays.map((day) => [day, String(values.get(day) ?? "").trim()]).filter((entry) => entry[1])); void submit(`hours:${location.id}`, { kind: "update_hours", locationId: location.id, hours }); }}>
        <div><strong>{location.label}</strong><small>{[location.city, location.region].filter(Boolean).join(", ") || "Primary location"}</small></div>
        <div className="owner-hours-grid">{weekdays.map((day) => <label key={day}><span>{day.slice(0, 3)}</span><input name={day} defaultValue={location.hours?.[day] ?? ""} placeholder="9:00 AM - 5:00 PM" /></label>)}</div>
        <button className="button secondary" type="submit" disabled={Boolean(busy)}>{busy === `hours:${location.id}` ? "Saving" : "Save hours"}</button>
      </form>)}{!state.locations.length ? <p className="muted">No source-backed location is available yet.</p> : null}</div>
    </section>
    <section className="panel" id="services"><div className="section-heading-row"><div><h2>Services</h2><p className="muted">Observed services can be confirmed, hidden, or assigned a dedicated page.</p></div><span className="badge">{state.offerings.length}</span></div>
      <form className="owner-authority-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void submit("offering:new", { kind: "add_offering", name: String(form.get("name") ?? ""), pageMode: form.get("pageMode") }); }}>
        <label>New service<input name="name" minLength={2} maxLength={160} placeholder="Service name" required /></label>
        <label>Page<ProductSelect name="pageMode" defaultValue="dedicated"><option value="none">No page</option><option value="shared">Shared page</option><option value="dedicated">Dedicated page</option></ProductSelect></label>
        <button className="button primary" type="submit" disabled={Boolean(busy)}>{busy === "offering:new" ? "Adding" : "Add service"}</button>
      </form>
      <div className="owner-authority-list">{state.offerings.map((offering) => <form className="owner-authority-row" key={offering.id} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void submit(offering.id, { kind: "set_offering", offeringId: offering.id, enabled: form.get("enabled") === "on", pageMode: form.get("pageMode") }); }}>
        <label className="owner-authority-check"><input name="enabled" type="checkbox" defaultChecked={offering.status !== "inactive" && offering.status !== "rejected"} /><span><strong>{offering.name}</strong><small>{offering.catalogId ? "Catalog service" : "Custom service"} · {offering.status}</small></span></label>
        <ProductSelect name="pageMode" defaultValue={offering.pageMode}><option value="none">No page</option><option value="shared">Shared page</option><option value="dedicated">Dedicated page</option></ProductSelect>
        <button className="button secondary" type="submit" disabled={Boolean(busy)}>{busy === offering.id ? "Saving" : "Update"}</button>
      </form>)}</div>
    </section>
    <section className="panel" id="proof-media"><div className="section-heading-row"><div><h2>Verified links</h2><p className="muted">External destinations require operator review before entering a replacement version.</p></div><span className="badge">{state.links.length}</span></div>
      <div className="owner-authority-list">{state.links.map((link) => <form className="owner-authority-row" key={link.id} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void submit(`link:${link.id}`, { kind: "update_external_link", linkId: link.id, url: String(form.get("url") ?? "") }); }}>
        <div><strong>{link.label}</strong><small>{link.kind}</small></div><input name="url" type="url" defaultValue={link.url} required /><button className="button secondary" type="submit" disabled={Boolean(busy)}>{busy === `link:${link.id}` ? "Submitting" : "Update"}</button>
      </form>)}{!state.links.length ? <p className="muted">No source-backed external links are available.</p> : null}</div>
    </section>
    <section className="panel"><div className="section-heading-row"><div><h2>Proof</h2><p className="muted">Trust-sensitive statements remain private until explicitly confirmed.</p></div><span className="badge">{state.proof.length}</span></div>
      <div className="owner-authority-list">{state.proof.map((proof) => <div className="owner-authority-row" key={proof.id}><div><strong>{proof.kind.replaceAll("_", " ")}</strong><p>{proof.publicText}</p><small>{proof.verbatim ? "Verbatim source excerpt" : "Deterministic fact"} · {proof.status}</small></div><button className="button secondary" type="button" disabled={Boolean(busy)} onClick={() => void submit(proof.id, { kind: "set_proof", proofId: proof.id, enabled: proof.status !== "confirmed" })}>{busy === proof.id ? "Saving" : proof.status === "confirmed" ? "Remove" : "Submit confirmation"}</button></div>)}{!state.proof.length ? <p className="muted">No source-backed proof was retained.</p> : null}</div>
    </section>
    <section className="panel"><div className="section-heading-row"><div><h2>Photos and logo</h2><p className="muted">Source-site, uploaded, and generated media are available to the website manager when they improve the result.</p></div><span className="badge">{state.assets.length}</span></div>
      <form className="owner-asset-upload" onSubmit={uploadAsset}>
        <label>Type<ProductSelect name="assetKind" defaultValue="photo"><option value="photo">Photo</option><option value="logo">Logo</option></ProductSelect></label>
        <label>Image<input name="assetFile" type="file" accept="image/png,image/jpeg,image/webp" required /></label>
        <label>Alt text<input name="assetAlt" maxLength={180} placeholder="Describe the image" required /></label>
        <button className="button primary" type="submit" disabled={Boolean(busy)}>{busy === "asset-upload" ? "Uploading" : "Add asset"}</button>
      </form>
      <div className="owner-authority-list">{state.assets.map((asset) => <div className="owner-authority-row" key={asset.revisionId}><div><strong>{asset.kind}</strong><p>{asset.alt || asset.assetId}</p><small>{asset.origin.replaceAll("_", " ")} · {asset.activeForFutureBuilds ? "active" : "inactive"}</small></div><div className="button-row"><button className="button secondary" type="button" disabled={Boolean(busy)} onClick={() => void submit(`active:${asset.assetId}`, { kind: "set_asset_active", assetId: asset.assetId, active: !asset.activeForFutureBuilds })}>{asset.activeForFutureBuilds ? "Deactivate" : "Activate"}</button></div></div>)}{!state.assets.length ? <p className="muted">No usable media is available yet.</p> : null}</div>
    </section>
    <section className="panel" id="site-preferences"><div className="section-heading-row"><div><h2>Site intent</h2><p className="muted">The manager uses this direction without selecting a template.</p></div><span className="badge">Revision {intent.revision}</span></div><dl className="detail-list"><dt>Audience</dt><dd>{intent.audience ?? "Not specified"}</dd><dt>Positioning</dt><dd>{intent.positioning ?? "Not specified"}</dd><dt>Voice</dt><dd>{intent.voice.join(", ")}</dd><dt>Conversion</dt><dd>{intent.primaryConversion}</dd><dt>Pages</dt><dd>{intent.pageRequirements.map((page) => page.title).join(", ")}</dd></dl>
      <form className="owner-authority-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void submit("intent:capabilities", { kind: "update_site_intent", patch: { enabledCapabilities: supportedCapabilities.filter((capability) => form.get(capability) === "on") } }); }}>
        <fieldset><legend>Managed capabilities</legend><div className="owner-capability-grid">{supportedCapabilities.map((capability) => <label className="owner-authority-check" key={capability}><input name={capability} type="checkbox" defaultChecked={intent.enabledCapabilities.includes(capability)} /><span>{capability}</span></label>)}</div></fieldset>
        <button className="button secondary" type="submit" disabled={Boolean(busy)}>{busy === "intent:capabilities" ? "Saving" : "Save capabilities"}</button>
      </form>
    </section>
    </div>
  </div>;
}

const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const supportedCapabilities = ["forms", "analytics", "maps", "proof", "gallery", "disclosure"] as const;
