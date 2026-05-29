"use client";

import { useState } from "react";
import type { BusinessProfile } from "@/lib/models";

type OwnerAssetsFormProps = {
  profile: BusinessProfile;
};

type AssetRow = {
  url: string;
  alt: string;
};

type OwnerAssetResponse = {
  ok?: boolean;
  error?: string;
};

export function OwnerAssetsForm({ profile }: OwnerAssetsFormProps) {
  const [logo, setLogo] = useState<AssetRow>({
    url: profile.logo?.url ?? "",
    alt: profile.logo?.alt ?? `${profile.name} logo`
  });
  const [photos, setPhotos] = useState<AssetRow[]>(
    profile.photos.length
      ? profile.photos.map((photo) => ({ url: photo.url, alt: photo.alt }))
      : [{ url: "", alt: `${profile.name} photo` }]
  );
  const [rightsAccepted, setRightsAccepted] = useState(false);
  const [status, setStatus] = useState("");

  function updatePhoto(index: number, patch: Partial<AssetRow>) {
    setPhotos((current) => current.map((photo, photoIndex) => (photoIndex === index ? { ...photo, ...patch } : photo)));
  }

  function addPhoto() {
    setPhotos((current) => [...current, { url: "", alt: `${profile.name} photo ${current.length + 1}` }]);
  }

  function removePhoto(index: number) {
    setPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index));
  }

  async function saveAssets(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("Saving owner-approved assets...");
    const response = await fetch("/api/assets/owner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteId: profile.siteId,
        logo: logo.url.trim() ? logo : undefined,
        photos: photos.filter((photo) => photo.url.trim() && photo.alt.trim()),
        rightsAccepted
      })
    });
    const result = (await response.json()) as OwnerAssetResponse;
    if (!response.ok || !result.ok) {
      setStatus(result.error ?? "Unable to save owner-approved assets.");
      return;
    }
    setRightsAccepted(false);
    setStatus("Owner-approved assets saved.");
  }

  return (
    <form className="editor-form owner-assets-form" onSubmit={saveAssets}>
      <div className="form-grid-two">
        <label>
          <span>Logo URL</span>
          <input value={logo.url} onChange={(event) => setLogo({ ...logo, url: event.target.value })} placeholder="https://..." />
        </label>
        <label>
          <span>Logo alt text</span>
          <input value={logo.alt} onChange={(event) => setLogo({ ...logo, alt: event.target.value })} />
        </label>
      </div>

      <div className="owner-asset-list">
        {photos.map((photo, index) => (
          <article className="owner-asset-row" key={`${index}-${photo.url}`}>
            <label>
              <span>Photo URL</span>
              <input value={photo.url} onChange={(event) => updatePhoto(index, { url: event.target.value })} placeholder="https://..." />
            </label>
            <label>
              <span>Alt text</span>
              <input value={photo.alt} onChange={(event) => updatePhoto(index, { alt: event.target.value })} />
            </label>
            <button className="button secondary" type="button" onClick={() => removePhoto(index)} disabled={photos.length <= 1}>
              Remove
            </button>
          </article>
        ))}
      </div>

      <label className="checkbox-row">
        <input type="checkbox" checked={rightsAccepted} onChange={(event) => setRightsAccepted(event.target.checked)} />
        <span>
          <strong>I have rights to use these assets</strong>
          <small>Approved photos and logos may be hosted or displayed on the published managed site.</small>
        </span>
      </label>

      <div className="button-row">
        <button className="button secondary" type="button" onClick={addPhoto}>
          Add photo
        </button>
        <button className="button primary" type="submit">
          Save assets
        </button>
      </div>
      {status ? <p className="form-status">{status}</p> : null}
    </form>
  );
}
