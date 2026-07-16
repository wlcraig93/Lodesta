"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AdminButton } from "@/components/admin/AdminButton";

export type BatchArchiveCandidate = {
  id: string;
  businessName: string;
  status: string;
};

export function CandidateBatchArchiveBar({ candidates }: { candidates: BatchArchiveCandidate[] }) {
  const router = useRouter();
  const archivable = useMemo(() => candidates.filter((candidate) => candidate.status !== "accepted"), [candidates]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!archivable.length) return null;

  const selected = new Set(selectedIds);
  const allSelected = selectedIds.length === archivable.length;

  function toggle(candidateId: string) {
    setSelectedIds((current) =>
      current.includes(candidateId) ? current.filter((id) => id !== candidateId) : [...current, candidateId]
    );
  }

  async function archiveSelected() {
    if (!selectedIds.length || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/site-candidates/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateIds: selectedIds })
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Archive failed.");
        return;
      }
      setSelectedIds([]);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Archive failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="candidate-batch-archive" aria-label="Batch archive candidates">
      <div className="candidate-batch-archive-head">
        <span>{selectedIds.length} selected</span>
        <div className="button-row">
          <AdminButton
            variant="secondary"
            type="button"
            onClick={() => setSelectedIds(allSelected ? [] : archivable.map((candidate) => candidate.id))}
            disabled={submitting}
          >
            {allSelected ? "Clear" : "Select all"}
          </AdminButton>
          <AdminButton variant="secondary" type="button" onClick={archiveSelected} disabled={submitting || !selectedIds.length}>
            {submitting ? "Archiving..." : "Archive selected"}
          </AdminButton>
        </div>
      </div>
      <div className="candidate-batch-archive-list">
        {archivable.map((candidate) => (
          <label key={candidate.id}>
            <input type="checkbox" checked={selected.has(candidate.id)} onChange={() => toggle(candidate.id)} />
            <span>{candidate.businessName}</span>
          </label>
        ))}
      </div>
      {error ? <p className="form-status error-text">{error}</p> : null}
    </section>
  );
}
