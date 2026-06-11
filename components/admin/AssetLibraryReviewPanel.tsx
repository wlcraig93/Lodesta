"use client";

import { useMemo, useState } from "react";
import type { AssetLibraryAsset, AssetLibraryBatch, AssetLibraryPolicyFailTag, AssetLibraryReviewDecision } from "@/lib/asset-library";

const SAFE_CLASSIFICATION_TAGS = [
  "service_detail",
  "hands_tools",
  "part_closeup",
  "tool_closeup",
  "tire_closeup",
  "glass_closeup",
  "shop_texture",
  "shop_environment"
] as const;

const POLICY_FAILURE_OPTIONS: Array<{ tag: AssetLibraryPolicyFailTag; label: string }> = [
  { tag: "policy_fail_shop_exterior", label: "Shop exterior" },
  { tag: "policy_fail_storefront", label: "Storefront" },
  { tag: "policy_fail_front_counter", label: "Front counter" },
  { tag: "policy_fail_waiting_area", label: "Waiting area" },
  { tag: "policy_fail_staff_customer", label: "Staff/customer implication" },
  { tag: "policy_fail_real_location_implied", label: "Real location implied" },
  { tag: "policy_fail_visible_face_subject", label: "Visible face subject" },
  { tag: "policy_fail_documents_forms", label: "Documents/forms/receipts" },
  { tag: "policy_fail_signage_pseudo_text", label: "Signage or pseudo-text" },
  { tag: "policy_fail_screens", label: "Screens" },
  { tag: "policy_fail_calibration_targets", label: "Calibration targets" },
  { tag: "policy_fail_people_visible", label: "People visible" },
  { tag: "policy_fail_plate_or_vin", label: "Plate or VIN" },
  { tag: "policy_fail_branding_logo", label: "Branding/logo" },
  { tag: "policy_fail_specific_vehicle_identity", label: "Specific vehicle identity" }
];

type AssetLibraryReviewPanelProps = {
  initialAssets: AssetLibraryAsset[];
  batches: AssetLibraryBatch[];
  filters: {
    vertical?: string;
    status?: string;
    tag?: string;
    use?: string;
    batch?: string;
  };
};

export function AssetLibraryReviewPanel({ initialAssets, batches, filters }: AssetLibraryReviewPanelProps) {
  const [assets, setAssets] = useState(initialAssets);
  const [policySelections, setPolicySelections] = useState<Record<string, AssetLibraryPolicyFailTag[]>>(() =>
    Object.fromEntries(initialAssets.map((asset) => [asset.id, policyFailTags(asset.tags)]))
  );
  const [busyAssetId, setBusyAssetId] = useState<string>();
  const [error, setError] = useState<string>();
  const activeAsset = assets[0];

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const asset of assets) counts[asset.status] = (counts[asset.status] ?? 0) + 1;
    return counts;
  }, [assets]);

  async function review(assetId: string, decision: AssetLibraryReviewDecision) {
    const policyFailureTags = policySelections[assetId] ?? [];
    setBusyAssetId(assetId);
    setError(undefined);
    try {
      const response = await fetch(`/api/admin/asset-library/${encodeURIComponent(assetId)}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reviewer: "admin-ui", policyFailureTags })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Review failed.");
      setAssets((current) => current.map((asset) => (asset.id === assetId ? payload.asset : asset)));
      setPolicySelections((current) => ({ ...current, [assetId]: policyFailTags(payload.asset.tags) }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyAssetId(undefined);
    }
  }

  async function updateTags(assetId: string, formData: FormData) {
    setBusyAssetId(assetId);
    setError(undefined);
    try {
      const tags = tokenList(String(formData.get("tags") ?? ""));
      const intendedUses = tokenList(String(formData.get("intendedUses") ?? ""));
      const response = await fetch(`/api/admin/asset-library/${encodeURIComponent(assetId)}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags, intendedUses })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Tag update failed.");
      setAssets((current) => current.map((asset) => (asset.id === assetId ? payload.asset : asset)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyAssetId(undefined);
    }
  }

  return (
    <div className="asset-library-review">
      <section className="panel asset-library-filters">
        <form method="get" className="asset-library-filter-form">
          <label>
            <span>Vertical</span>
            <input name="vertical" defaultValue={filters.vertical ?? "auto_services"} />
          </label>
          <label>
            <span>Status</span>
            <select name="status" defaultValue={filters.status ?? ""}>
              <option value="">Active</option>
              <option value="all">All statuses</option>
              <option value="candidate">Candidate</option>
              <option value="needs_edit">Needs edit</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <label>
            <span>Tag</span>
            <input name="tag" defaultValue={filters.tag ?? ""} placeholder="tires" />
          </label>
          <label>
            <span>Use</span>
            <input name="use" defaultValue={filters.use ?? ""} placeholder="hero" />
          </label>
          <label>
            <span>Batch</span>
            <select name="batch" defaultValue={filters.batch ?? ""}>
              <option value="">All batches</option>
              {batches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.manifestName} / {batch.id}
                </option>
              ))}
            </select>
          </label>
          <button className="admin-button admin-button-md admin-button-secondary" type="submit">Filter</button>
        </form>
        <div className="asset-library-counts">
          <span>{assets.length} shown</span>
          {Object.entries(statusCounts).map(([status, count]) => (
            <span key={status}>{status}: {count}</span>
          ))}
        </div>
      </section>

      {error ? <p className="error-text">{error}</p> : null}

      <section className="asset-library-grid" aria-label="Asset candidates">
        {assets.map((asset) => {
          const selectedFailures = policySelections[asset.id] ?? [];
          const policy = policySummary(asset, selectedFailures);
          return (
          <article key={asset.id} className="asset-library-card">
            <img src={`/api/admin/asset-library/${encodeURIComponent(asset.id)}/preview`} alt={asset.promptMetadata.title} />
            <div className="asset-library-card-body">
              <span className={`badge status-${asset.status}`}>{asset.status}</span>
              <h2>{asset.promptMetadata.title}</h2>
              <p>{asset.promptMetadata.notes}</p>
              <dl>
                <div><dt>Category</dt><dd>{asset.category}</dd></div>
                <div><dt>Use</dt><dd>{asset.intendedUses.join(", ")}</dd></div>
                <div><dt>Tags</dt><dd>{asset.tags.join(", ")}</dd></div>
                <div><dt>QC</dt><dd>{asset.qc.ok ? "passed" : "needs review"}</dd></div>
                <div><dt>Policy</dt><dd>{policy.siteSelectable ? "site-selectable category image" : "reject for public site use"}</dd></div>
              </dl>
              <div className={`asset-library-policy ${policy.siteSelectable ? "is-selectable" : "is-blocked"}`}>
                <strong>{policy.siteSelectable ? "Selectable category imagery" : "Approval blocked"}</strong>
                <p>
                  Generated assets must be service/category imagery only. They cannot imply the actual shop, staff,
                  customers, exterior, paperwork, screens, or customer work.
                </p>
                {policy.reasons.length ? <small>{policy.reasons.join("; ")}</small> : null}
              </div>
              <fieldset className="asset-library-policy-checklist">
                <legend>Honesty checklist</legend>
                {POLICY_FAILURE_OPTIONS.map((option) => (
                  <label key={option.tag}>
                    <input
                      type="checkbox"
                      checked={selectedFailures.includes(option.tag)}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setPolicySelections((current) => {
                          const currentTags = current[asset.id] ?? [];
                          const nextTags = checked
                            ? Array.from(new Set([...currentTags, option.tag]))
                            : currentTags.filter((tag) => tag !== option.tag);
                          return { ...current, [asset.id]: nextTags };
                        });
                      }}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </fieldset>
              <details>
                <summary>Prompt</summary>
                <p>{asset.promptMetadata.prompt}</p>
                <small>{asset.promptMetadata.negativeConstraints.join("; ")}</small>
              </details>
              <form
                className="asset-library-tags-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  updateTags(asset.id, new FormData(event.currentTarget));
                }}
              >
                <label>
                  <span>Tags</span>
                  <input name="tags" defaultValue={asset.tags.join(", ")} />
                </label>
                <label>
                  <span>Uses</span>
                  <input name="intendedUses" defaultValue={asset.intendedUses.join(", ")} />
                </label>
                <button className="admin-button admin-button-md admin-button-secondary" type="submit" disabled={busyAssetId === asset.id}>Save metadata</button>
              </form>
              <div className="asset-library-actions">
                <button className="admin-button admin-button-md admin-button-primary" type="button" disabled={busyAssetId === asset.id || asset.status === "approved" || !policy.siteSelectable} onClick={() => review(asset.id, "approved")}>Approve</button>
                <button className="admin-button admin-button-md admin-button-secondary" type="button" disabled={busyAssetId === asset.id} onClick={() => review(asset.id, "needs_edit")}>Needs edit</button>
                <button className="admin-button admin-button-md admin-button-secondary" type="button" disabled={busyAssetId === asset.id} onClick={() => review(asset.id, "rejected")}>Reject</button>
                <button className="admin-button admin-button-md admin-button-secondary" type="button" disabled={busyAssetId === asset.id} onClick={() => review(asset.id, "archived")}>Archive</button>
              </div>
              {asset.publicUrl ? <code>{asset.publicUrl}</code> : null}
            </div>
          </article>
          );
        })}
      </section>

      {!assets.length ? (
        <section className="panel">
          <h2>No assets match these filters.</h2>
          <p className="muted">Generate a batch with the asset-library CLI, then review candidates here.</p>
        </section>
      ) : null}

      {activeAsset ? (
        <section className="panel admin-section">
          <h2>First asset QC</h2>
          <table className="data-table">
            <thead>
              <tr><th>Check</th><th>Status</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {activeAsset.qc.checks.map((check) => (
                <tr key={check.id}>
                  <td>{check.id}</td>
                  <td>{check.ok ? "pass" : "fail"}</td>
                  <td>{check.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}

function tokenList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function policyFailTags(tags: string[]): AssetLibraryPolicyFailTag[] {
  return tags.filter((tag): tag is AssetLibraryPolicyFailTag => POLICY_FAILURE_OPTIONS.some((option) => option.tag === tag));
}

function policySummary(asset: AssetLibraryAsset, selectedFailures: AssetLibraryPolicyFailTag[]) {
  const tags = new Set([...asset.tags, ...asset.promptMetadata.tags]);
  const classificationCount = SAFE_CLASSIFICATION_TAGS.filter((tag) => tags.has(tag)).length;
  const reasons: string[] = [...selectedFailures];
  if (classificationCount === 0) reasons.push("missing_safe_subject_classification");
  if (classificationCount > 1) reasons.push("multiple_safe_subject_classifications");
  if (tags.has("no_location_context") && classificationCount !== 1) reasons.push("no_location_context_without_subject_classification");
  return { siteSelectable: reasons.length === 0, reasons };
}
