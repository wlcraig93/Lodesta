"use client";

import { useState } from "react";
import type { BusinessProfile } from "@/lib/models";

type OwnerAssetsFormProps = {
  profile: BusinessProfile;
};

type AssetRow = {
  url: string;
  alt: string;
  rightsConfirmed: boolean;
};

type UploadRow = {
  file?: File;
  alt: string;
  rightsConfirmed: boolean;
};

type OwnerAssetResponse = {
  ok?: boolean;
  error?: string;
  logo?: AssetRow;
  photos?: AssetRow[];
};

const maxUploadBytes = 5 * 1024 * 1024;
const acceptedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export function OwnerAssetsForm({ profile }: OwnerAssetsFormProps) {
  const [logo, setLogo] = useState<AssetRow>({
    url: profile.logo?.url ?? "",
    alt: profile.logo?.alt ?? `${profile.name} logo`,
    rightsConfirmed: false
  });
  const [logoUpload, setLogoUpload] = useState<UploadRow>({ alt: `${profile.name} logo`, rightsConfirmed: false });
  const [photos, setPhotos] = useState<AssetRow[]>(
    profile.photos.filter((photo) => photo.rightsStatus !== "reference_only").length
      ? profile.photos
          .filter((photo) => photo.rightsStatus !== "reference_only")
          .map((photo) => ({ url: photo.url, alt: photo.alt, rightsConfirmed: false }))
      : [{ url: "", alt: `${profile.name} photo`, rightsConfirmed: false }]
  );
  const [photoUploads, setPhotoUploads] = useState<UploadRow[]>([{ alt: `${profile.name} uploaded photo`, rightsConfirmed: false }]);
  const scrapedPhotos = profile.photos.filter((photo) => photo.rightsStatus === "reference_only");
  const [scrapedAttested, setScrapedAttested] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState("");

  function updatePhoto(index: number, patch: Partial<AssetRow>) {
    setPhotos((current) => current.map((photo, photoIndex) => (photoIndex === index ? { ...photo, ...patch } : photo)));
  }

  function addPhoto() {
    setPhotos((current) => [...current, { url: "", alt: `${profile.name} photo ${current.length + 1}`, rightsConfirmed: false }]);
  }

  function removePhoto(index: number) {
    setPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index));
  }

  function updatePhotoUpload(index: number, patch: Partial<UploadRow>) {
    setPhotoUploads((current) => current.map((upload, uploadIndex) => (uploadIndex === index ? { ...upload, ...patch } : upload)));
  }

  function addPhotoUpload() {
    setPhotoUploads((current) => [...current, { alt: `${profile.name} uploaded photo ${current.length + 1}`, rightsConfirmed: false }]);
  }

  function removePhotoUpload(index: number) {
    setPhotoUploads((current) => current.filter((_, uploadIndex) => uploadIndex !== index));
  }

  async function saveAssets(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalidUpload = [logoUpload.file, ...photoUploads.map((upload) => upload.file)].some((file) =>
      file ? !acceptedImageTypes.has(file.type) || file.size > maxUploadBytes : false
    );
    if (invalidUpload) {
      setStatus("Upload PNG, JPEG, or WebP images no larger than 5 MB.");
      return;
    }

    setStatus("Saving owner-approved assets...");
    const formData = new FormData();
    formData.set("siteId", profile.siteId);
    if (logo.url.trim()) {
      formData.set("logoUrl", logo.url.trim());
      formData.set("logoRights", logo.rightsConfirmed ? "true" : "false");
    }
    if (logo.alt.trim()) formData.set("logoAlt", logo.alt.trim());
    if (logoUpload.file) {
      formData.set("logoFile", logoUpload.file);
      formData.set("logoAlt", logoUpload.alt.trim() || `${profile.name} logo`);
      formData.set("logoRights", logoUpload.rightsConfirmed ? "true" : "false");
    }
    for (const photo of photos) {
      if (!photo.url.trim() || !photo.alt.trim()) continue;
      formData.append("photoUrl", photo.url.trim());
      formData.append("photoUrlAlt", photo.alt.trim());
      formData.append("photoUrlRights", photo.rightsConfirmed ? "true" : "false");
    }
    for (const upload of photoUploads) {
      if (!upload.file) continue;
      formData.append("photoFiles", upload.file);
      formData.append("photoAlt", upload.alt.trim() || `${profile.name} uploaded photo`);
      formData.append("photoRights", upload.rightsConfirmed ? "true" : "false");
    }
    for (const [assetId, confirmed] of Object.entries(scrapedAttested)) {
      if (confirmed) formData.append("scrapedAssetId", assetId);
    }

    const response = await fetch("/api/assets/owner", {
      method: "POST",
      body: formData
    });
    const result = (await response.json()) as OwnerAssetResponse;
    if (!response.ok || !result.ok) {
      setStatus(result.error ?? "Unable to save owner-approved assets.");
      return;
    }
    if (result.logo) setLogo({ url: result.logo.url, alt: result.logo.alt, rightsConfirmed: false });
    if (result.photos?.length) setPhotos(result.photos.map((photo) => ({ url: photo.url, alt: photo.alt, rightsConfirmed: false })));
    setLogoUpload({ alt: `${profile.name} logo`, rightsConfirmed: false });
    setPhotoUploads([{ alt: `${profile.name} uploaded photo`, rightsConfirmed: false }]);
    setScrapedAttested({});
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

      <div className="owner-upload-row">
        <label>
          <span>Upload logo</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => setLogoUpload({ ...logoUpload, file: event.target.files?.[0] })}
          />
        </label>
        <label>
          <span>Uploaded logo alt text</span>
          <input value={logoUpload.alt} onChange={(event) => setLogoUpload({ ...logoUpload, alt: event.target.value })} />
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
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={photo.rightsConfirmed}
                onChange={(event) => updatePhoto(index, { rightsConfirmed: event.target.checked })}
              />
              <span>I own this image or hold the rights to use it</span>
            </label>
            <button className="button secondary" type="button" onClick={() => removePhoto(index)} disabled={photos.length <= 1}>
              Remove
            </button>
          </article>
        ))}
      </div>

      <div className="owner-upload-list">
        {photoUploads.map((upload, index) => (
          <article className="owner-upload-row" key={`upload-${index}`}>
            <label>
              <span>Upload photo</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => updatePhotoUpload(index, { file: event.target.files?.[0] })}
              />
            </label>
            <label>
              <span>Uploaded photo alt text</span>
              <input value={upload.alt} onChange={(event) => updatePhotoUpload(index, { alt: event.target.value })} />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={upload.rightsConfirmed}
                onChange={(event) => updatePhotoUpload(index, { rightsConfirmed: event.target.checked })}
              />
              <span>I own this image or hold the rights to use it</span>
            </label>
            <button
              className="button secondary"
              type="button"
              onClick={() => removePhotoUpload(index)}
              disabled={photoUploads.length <= 1}
            >
              Remove
            </button>
          </article>
        ))}
      </div>

      {scrapedPhotos.length ? (
        <div className="owner-scraped-list">
          <h3>Images from your current website</h3>
          <p>
            These were found on your existing site. Confirm the ones you own (or hold rights to) and they become usable on
            your managed site; unconfirmed images are never published.
          </p>
          {scrapedPhotos.map((photo) => (
            <label className="checkbox-row" key={photo.id}>
              <input
                type="checkbox"
                checked={Boolean(scrapedAttested[photo.id])}
                onChange={(event) => setScrapedAttested((current) => ({ ...current, [photo.id]: event.target.checked }))}
              />
              <span>
                <strong>{photo.alt || photo.url}</strong>
                <small>I own this image or hold the rights to use it on this website.</small>
              </span>
            </label>
          ))}
        </div>
      ) : null}

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={logo.rightsConfirmed && logoUpload.rightsConfirmed}
          onChange={(event) => {
            setLogo((current) => ({ ...current, rightsConfirmed: event.target.checked }));
            setLogoUpload((current) => ({ ...current, rightsConfirmed: event.target.checked }));
          }}
        />
        <span>
          <strong>I own the logo or hold the rights to use it</strong>
          <small>Each photo above also needs its own confirmation; rights are recorded per image.</small>
        </span>
      </label>

      <div className="button-row">
        <button className="button secondary" type="button" onClick={addPhoto}>
          Add photo
        </button>
        <button className="button secondary" type="button" onClick={addPhotoUpload}>
          Add upload
        </button>
        <button className="button primary" type="submit">
          Save assets
        </button>
      </div>
      {status ? <p className="form-status">{status}</p> : null}
    </form>
  );
}
