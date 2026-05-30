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

type UploadRow = {
  file?: File;
  alt: string;
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
    alt: profile.logo?.alt ?? `${profile.name} logo`
  });
  const [logoUpload, setLogoUpload] = useState<UploadRow>({ alt: `${profile.name} logo` });
  const [photos, setPhotos] = useState<AssetRow[]>(
    profile.photos.length
      ? profile.photos.map((photo) => ({ url: photo.url, alt: photo.alt }))
      : [{ url: "", alt: `${profile.name} photo` }]
  );
  const [photoUploads, setPhotoUploads] = useState<UploadRow[]>([{ alt: `${profile.name} uploaded photo` }]);
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

  function updatePhotoUpload(index: number, patch: Partial<UploadRow>) {
    setPhotoUploads((current) => current.map((upload, uploadIndex) => (uploadIndex === index ? { ...upload, ...patch } : upload)));
  }

  function addPhotoUpload() {
    setPhotoUploads((current) => [...current, { alt: `${profile.name} uploaded photo ${current.length + 1}` }]);
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
    formData.set("rightsAccepted", rightsAccepted ? "true" : "false");
    if (logo.url.trim()) formData.set("logoUrl", logo.url.trim());
    if (logo.alt.trim()) formData.set("logoAlt", logo.alt.trim());
    if (logoUpload.file) {
      formData.set("logoFile", logoUpload.file);
      formData.set("logoAlt", logoUpload.alt.trim() || `${profile.name} logo`);
    }
    for (const photo of photos) {
      if (!photo.url.trim() || !photo.alt.trim()) continue;
      formData.append("photoUrl", photo.url.trim());
      formData.append("photoUrlAlt", photo.alt.trim());
    }
    for (const upload of photoUploads) {
      if (!upload.file) continue;
      formData.append("photoFiles", upload.file);
      formData.append("photoAlt", upload.alt.trim() || `${profile.name} uploaded photo`);
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
    if (result.logo) setLogo({ url: result.logo.url, alt: result.logo.alt });
    if (result.photos?.length) setPhotos(result.photos.map((photo) => ({ url: photo.url, alt: photo.alt })));
    setLogoUpload({ alt: `${profile.name} logo` });
    setPhotoUploads([{ alt: `${profile.name} uploaded photo` }]);
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
