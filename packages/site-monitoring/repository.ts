import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getSupabaseAdminClient } from "@/lib/supabase/client";
import { configuredRepositoryMode } from "@/packages/execution-environment";

export type SiteMonitorKind = "site" | "form";

export type SiteMonitorCheck = {
  id: string;
  siteId: string;
  kind: SiteMonitorKind;
  target: string;
  ok: boolean;
  detail: Record<string, unknown>;
  checkedAt: string;
};

export interface SiteMonitorRepository {
  record(check: Omit<SiteMonitorCheck, "id">): Promise<SiteMonitorCheck>;
  /** Newest first. */
  recent(siteId: string, kind: SiteMonitorKind, limit: number): Promise<SiteMonitorCheck[]>;
}

class LocalSiteMonitorRepository implements SiteMonitorRepository {
  private queue = Promise.resolve();

  constructor(private readonly path = resolve(process.cwd(), ".data", "site-platform", "site-monitor-checks.json")) {}

  async record(check: Omit<SiteMonitorCheck, "id">) {
    const value = { ...check, id: `monitor_${crypto.randomUUID()}` };
    const next = this.queue.then(async () => {
      const items = await this.read();
      // Keep a bounded local history per site and kind.
      const kept = [value, ...items].filter((item, index, all) => all.filter((other, otherIndex) => otherIndex < index && other.siteId === item.siteId && other.kind === item.kind).length < 50);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(kept, null, 2));
      await rename(temporary, this.path);
    });
    this.queue = next.catch(() => undefined);
    await next;
    return value;
  }

  async recent(siteId: string, kind: SiteMonitorKind, limit: number) {
    return (await this.read())
      .filter((item) => item.siteId === siteId && item.kind === kind)
      .sort((left, right) => right.checkedAt.localeCompare(left.checkedAt))
      .slice(0, limit);
  }

  private async read(): Promise<SiteMonitorCheck[]> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as SiteMonitorCheck[];
    } catch {
      return [];
    }
  }
}

type SiteMonitorRow = { id: string; site_id: string; kind: SiteMonitorKind; target: string; ok: boolean; detail: Record<string, unknown>; checked_at: string };

class SupabaseSiteMonitorRepository implements SiteMonitorRepository {
  private get client() { return getSupabaseAdminClient(); }

  async record(check: Omit<SiteMonitorCheck, "id">) {
    const id = `monitor_${crypto.randomUUID()}`;
    const { error } = await this.client.from("site_monitor_checks").insert({
      id, site_id: check.siteId, kind: check.kind, target: check.target.slice(0, 500), ok: check.ok, detail: check.detail, checked_at: check.checkedAt
    });
    if (error) throw new Error(`Record site monitor check: ${error.message}`);
    return { ...check, id };
  }

  async recent(siteId: string, kind: SiteMonitorKind, limit: number) {
    const { data, error } = await this.client.from("site_monitor_checks").select("*")
      .eq("site_id", siteId).eq("kind", kind).order("checked_at", { ascending: false }).limit(limit);
    if (error) throw new Error(`List site monitor checks: ${error.message}`);
    return ((data ?? []) as SiteMonitorRow[]).map((row) => ({
      id: row.id, siteId: row.site_id, kind: row.kind, target: row.target, ok: row.ok, detail: row.detail ?? {}, checkedAt: row.checked_at
    }));
  }
}

export const siteMonitorRepository: SiteMonitorRepository = configuredRepositoryMode() === "local"
  ? new LocalSiteMonitorRepository()
  : new SupabaseSiteMonitorRepository();

export function createLocalSiteMonitorRepository(path: string): SiteMonitorRepository {
  return new LocalSiteMonitorRepository(path);
}
