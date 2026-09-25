/**
 * Owner-facing wording for internal failures. The raw error is logged on the
 * server; owners get a plain sentence and a stable code, never an internal
 * message, run ID or stack detail.
 */
const ownerMessages: Array<[RegExp, string, string]> = [
  [/concurrent_project_limit/, "concurrent_limit", "You already have several website updates in progress. Wait for one to finish, then try again."],
  [/Session already has an active run|session_has_active_run/, "update_in_progress", "An update is already in progress. It will finish before the next one starts."],
  [/stale_control_plane_change|stale_parent_revision|stale_selection|stale_failed_run/, "changed_meanwhile", "Your website changed while this was being prepared. Refresh the page and try again."],
  [/owner_authority_changed/, "details_changed", "Your business details changed after this version was made. Review the refreshed version before publishing."],
  [/version_not_promotable|candidate_changed/, "newer_version", "A newer version is ready. Review it before publishing."],
  [/candidate_release_storage_unavailable|candidate_verification_unavailable/, "temporarily_unavailable", "We couldn't check this version right now. Nothing was published. Try again in a few minutes."],
  [/candidate_integrity_failed|candidate_source_coverage_missing|candidate_redirect_conflict/, "needs_rebuild", "This version has a technical problem, so it can't be published. Ask for a small change to rebuild it, or contact support."],
  [/run_not_retryable/, "not_retryable", "This update can't be retried. Ask for the change again in the chat."],
  [/run_is_not_waiting_for_input/, "no_question_pending", "There's no open question to answer right now."],
  [/site_authoring_maintenance_active/, "maintenance", "Lodesta is updating right now. Try again in a few minutes."],
  [/retained_restore_target_unavailable|retained_restore_backup_unavailable/, "version_unavailable", "That earlier version is no longer available."],
  [/site_owner_required/, "not_owner", "Only the website's owner can do that."],
  [/A phone or email value is required/, "contact_required", "Enter a phone number or email address."],
  [/This service already exists/, "duplicate_service", "That service is already listed."],
  [/owner_document_target_stale/, "changed_meanwhile", "That page changed while you were editing it. Refresh and try again."],
  [/owner_document_approval_required|owner_document_owner_required/, "not_owner", "Only the website's owner can approve that document."],
  [/workflow_deadline_exhausted/, "timed_out", "This took too long and was stopped. Your live website hasn't changed. Try again."]
];

export function ownerFacingError(error: unknown, context: string, fallback = "Something went wrong on our side. Your live website hasn't changed. Try again in a minute.") {
  const raw = error instanceof Error ? error.message : String(error);
  const match = ownerMessages.find(([pattern]) => pattern.test(raw));
  console.error(JSON.stringify({ event: "owner_request_failed", context, code: match?.[1] ?? "unexpected", message: raw.slice(0, 500) }));
  return { error: match?.[2] ?? fallback, code: match?.[1] ?? "unexpected" };
}
