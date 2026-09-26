import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getSupabaseAdminClient } from "@/lib/supabase/client";
import { configuredRepositoryMode } from "@/packages/execution-environment";

export type OwnerNotificationKind = "lead" | "run_failed" | "domain_attention" | "site_unreachable" | "form_unreachable" | "report_access";
export type OwnerNotificationStatus = "pending" | "sending" | "sent" | "failed" | "suppressed";

/**
 * A delivery record for something the inbox or run history already holds.
 * `audience: "operator"` goes to Lodesta's alert address. `audience: "requester"`
 * is a report access email with no site, sent to the address typed into the
 * report form.
 */
export type OwnerNotification = {
  id: string;
  /** Absent only for requester report access emails. */
  siteId?: string;
  kind: OwnerNotificationKind;
  subjectId: string;
  dedupeKey: string;
  audience: "owner" | "operator" | "requester";
  test: boolean;
  status: OwnerNotificationStatus;
  attempts: number;
  nextAttemptAt: string;
  claimedBy?: string;
  claimedAt?: string;
  lastError?: string;
  suppressedReason?: string;
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type EnqueueOwnerNotification = Pick<OwnerNotification, "siteId" | "kind" | "subjectId" | "dedupeKey" | "audience" | "test">;

export interface OwnerNotificationRepository {
  /** Idempotent by dedupeKey; returns false when the notification already exists. */
  enqueue(input: EnqueueOwnerNotification, now?: Date): Promise<boolean>;
  claimDue(workerId: string, limit: number, now?: Date): Promise<OwnerNotification[]>;
  markSent(id: string, now?: Date): Promise<void>;
  markSuppressed(id: string, reason: string, now?: Date): Promise<void>;
  /** Schedules a retry, or records a terminal failure when nextAttemptAt is null. */
  markFailed(id: string, error: string, nextAttemptAt: Date | null, now?: Date): Promise<void>;
  list(input?: { siteId?: string; statuses?: OwnerNotificationStatus[]; limit?: number }): Promise<OwnerNotification[]>;
}

const staleClaimMs = 5 * 60_000;

class LocalOwnerNotificationRepository implements OwnerNotificationRepository {
  private queue = Promise.resolve();

  constructor(private readonly path = resolve(process.cwd(), ".data", "site-platform", "owner-notifications.json")) {}

  async enqueue(input: EnqueueOwnerNotification, now = new Date()) {
    let created = false;
    await this.write((items) => {
      if (items.some((item) => item.dedupeKey === input.dedupeKey)) return;
      const at = now.toISOString();
      items.push({ ...input, id: `notification_${crypto.randomUUID()}`, status: "pending", attempts: 0, nextAttemptAt: at, createdAt: at, updatedAt: at });
      created = true;
    });
    return created;
  }

  async claimDue(workerId: string, limit: number, now = new Date()) {
    const claimed: OwnerNotification[] = [];
    await this.write((items) => {
      const at = now.toISOString();
      const staleBefore = new Date(now.getTime() - staleClaimMs).toISOString();
      for (const item of items.filter((candidate) => (candidate.status === "pending" && candidate.nextAttemptAt <= at)
        || (candidate.status === "sending" && (candidate.claimedAt ?? at) < staleBefore))
        .sort((left, right) => left.nextAttemptAt.localeCompare(right.nextAttemptAt) || left.id.localeCompare(right.id))
        .slice(0, Math.max(1, Math.min(limit, 50)))) {
        Object.assign(item, { status: "sending", claimedBy: workerId, claimedAt: at, attempts: item.attempts + 1, updatedAt: at });
        claimed.push({ ...item });
      }
    });
    return claimed;
  }

  markSent(id: string, now = new Date()) {
    return this.update(id, { status: "sent", sentAt: now.toISOString(), lastError: undefined }, now);
  }

  markSuppressed(id: string, reason: string, now = new Date()) {
    return this.update(id, { status: "suppressed", suppressedReason: reason.slice(0, 200) }, now);
  }

  markFailed(id: string, error: string, nextAttemptAt: Date | null, now = new Date()) {
    return this.update(id, nextAttemptAt
      ? { status: "pending", lastError: error.slice(0, 2000), nextAttemptAt: nextAttemptAt.toISOString() }
      : { status: "failed", lastError: error.slice(0, 2000) }, now);
  }

  async list(input: { siteId?: string; statuses?: OwnerNotificationStatus[]; limit?: number } = {}) {
    const items = await this.read();
    return items
      .filter((item) => (!input.siteId || item.siteId === input.siteId) && (!input.statuses || input.statuses.includes(item.status)))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, input.limit ?? 100);
  }

  private async update(id: string, patch: Partial<OwnerNotification>, now: Date) {
    await this.write((items) => {
      const item = items.find((candidate) => candidate.id === id);
      if (item) Object.assign(item, patch, { updatedAt: now.toISOString() });
    });
  }

  private async read(): Promise<OwnerNotification[]> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as OwnerNotification[];
    } catch {
      return [];
    }
  }

  private async write(mutate: (items: OwnerNotification[]) => void) {
    const next = this.queue.then(async () => {
      const items = await this.read();
      mutate(items);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(items, null, 2));
      await rename(temporary, this.path);
    });
    this.queue = next.catch(() => undefined);
    await next;
  }
}

type OwnerNotificationRow = {
  id: string; site_id: string | null; kind: OwnerNotificationKind; subject_id: string; dedupe_key: string;
  audience: "owner" | "operator" | "requester"; test: boolean; status: OwnerNotificationStatus; attempts: number;
  next_attempt_at: string; claimed_by: string | null; claimed_at: string | null; last_error: string | null;
  suppressed_reason: string | null; sent_at: string | null; created_at: string; updated_at: string;
};

class SupabaseOwnerNotificationRepository implements OwnerNotificationRepository {
  private get client() { return getSupabaseAdminClient(); }

  async enqueue(input: EnqueueOwnerNotification, now = new Date()) {
    const at = now.toISOString();
    const { data, error } = await this.client.from("owner_notifications").upsert({
      id: `notification_${crypto.randomUUID()}`, site_id: input.siteId ?? null, kind: input.kind, subject_id: input.subjectId,
      dedupe_key: input.dedupeKey, audience: input.audience, test: input.test, status: "pending",
      next_attempt_at: at, created_at: at, updated_at: at
    }, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
    if (error) throw new Error(`Enqueue owner notification: ${error.message}`);
    return (data ?? []).length > 0;
  }

  async claimDue(workerId: string, limit: number, now = new Date()) {
    const { data, error } = await this.client.rpc("claim_owner_notifications", {
      target_worker_id: workerId, target_limit: limit, target_now: now.toISOString()
    });
    if (error) throw new Error(`Claim owner notifications: ${error.message}`);
    return ((data ?? []) as OwnerNotificationRow[]).map(rowToNotification);
  }

  markSent(id: string, now = new Date()) {
    return this.update(id, { status: "sent", sent_at: now.toISOString(), last_error: null }, now);
  }

  markSuppressed(id: string, reason: string, now = new Date()) {
    return this.update(id, { status: "suppressed", suppressed_reason: reason.slice(0, 200) }, now);
  }

  markFailed(id: string, error: string, nextAttemptAt: Date | null, now = new Date()) {
    return this.update(id, nextAttemptAt
      ? { status: "pending", last_error: error.slice(0, 2000), next_attempt_at: nextAttemptAt.toISOString() }
      : { status: "failed", last_error: error.slice(0, 2000) }, now);
  }

  async list(input: { siteId?: string; statuses?: OwnerNotificationStatus[]; limit?: number } = {}) {
    let query = this.client.from("owner_notifications").select("*").order("created_at", { ascending: false }).limit(input.limit ?? 100);
    if (input.siteId) query = query.eq("site_id", input.siteId);
    if (input.statuses) query = query.in("status", input.statuses);
    const { data, error } = await query;
    if (error) throw new Error(`List owner notifications: ${error.message}`);
    return ((data ?? []) as OwnerNotificationRow[]).map(rowToNotification);
  }

  private async update(id: string, patch: Record<string, unknown>, now: Date) {
    const { error } = await this.client.from("owner_notifications").update({ ...patch, updated_at: now.toISOString() }).eq("id", id);
    if (error) throw new Error(`Update owner notification: ${error.message}`);
  }
}

function rowToNotification(row: OwnerNotificationRow): OwnerNotification {
  return {
    id: row.id, siteId: row.site_id ?? undefined, kind: row.kind, subjectId: row.subject_id, dedupeKey: row.dedupe_key,
    audience: row.audience, test: row.test, status: row.status, attempts: row.attempts, nextAttemptAt: row.next_attempt_at,
    ...(row.claimed_by ? { claimedBy: row.claimed_by } : {}),
    ...(row.claimed_at ? { claimedAt: row.claimed_at } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    ...(row.suppressed_reason ? { suppressedReason: row.suppressed_reason } : {}),
    ...(row.sent_at ? { sentAt: row.sent_at } : {}),
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export const ownerNotificationRepository: OwnerNotificationRepository = configuredRepositoryMode() === "local"
  ? new LocalOwnerNotificationRepository()
  : new SupabaseOwnerNotificationRepository();

export function createLocalOwnerNotificationRepository(path: string): OwnerNotificationRepository {
  return new LocalOwnerNotificationRepository(path);
}
