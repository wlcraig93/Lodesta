import { platformOperationsRepository, type DomainRecord, type PlatformOperationsRepository } from "@/packages/platform-operations";

const reconciliationIntervalMs: Record<DomainRecord["status"], number | undefined> = {
  pending_verification: 5 * 60_000,
  provisioning: 15 * 60_000,
  active: 36 * 60 * 60_000,
  attention_required: 6 * 60 * 60_000,
  expired: undefined,
  conflict: undefined
};

export function isDomainReconciliationDue(domain: DomainRecord, now = new Date()) {
  const interval = reconciliationIntervalMs[domain.status];
  return interval !== undefined && Date.parse(domain.updatedAt) <= now.getTime() - interval;
}

export async function processDomainReconciliations(input: {
  limit?: number;
  repository?: PlatformOperationsRepository;
  now?: Date;
} = {}) {
  const repository = input.repository ?? platformOperationsRepository;
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 4, 20));
  const due = (await repository.listDomains())
    .filter((domain) => isDomainReconciliationDue(domain, now))
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
    .slice(0, limit);
  return Promise.all(due.map((domain) => repository.refreshDomain({ domainId: domain.id })));
}
