import { z } from "zod";
import type { SiteAgentRunAdminQuery, SiteAgentRunAdminSort } from "@/packages/platform-data";
import type { SiteAgentRun } from "@/packages/site-contracts";

export const adminRunStatuses = ["queued", "running", "needs_input", "succeeded", "failed", "cancelled"] as const;
export const adminRunSorts = ["newest", "oldest", "highest_cost", "lowest_cost", "longest_duration"] as const;
export const adminRunPageSizes = [25, 50, 100] as const;

const querySchema = z.object({
  q: z.string().trim().max(160).optional(),
  status: z.string().max(200).optional(),
  siteId: z.string().trim().max(160).optional(),
  range: z.enum(["24h", "7d", "30d"]).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  sort: z.enum(adminRunSorts).default("newest"),
  limit: z.coerce.number().int().refine((value) => adminRunPageSizes.includes(value as 25 | 50 | 100)).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0)
}).strict().superRefine((value, context) => {
  if (value.range && (value.from || value.to)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["range"], message: "A preset range cannot be combined with custom dates." });
  }
  if (value.from && value.to && value.from > value.to) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "The end date must not be before the start date." });
  }
  const statuses = parseStatusList(value.status);
  if (statuses.some((status) => !adminRunStatuses.includes(status as SiteAgentRun["status"]))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "One or more run statuses are invalid." });
  }
});

export function parseAdminRunQuery(searchParams: URLSearchParams) {
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) return parsed;
  const value = parsed.data;
  const presetHours = value.range === "24h" ? 24 : value.range === "7d" ? 24 * 7 : value.range === "30d" ? 24 * 30 : undefined;
  return {
    success: true as const,
    data: {
      search: value.q || undefined,
      statuses: parseStatusList(value.status) as SiteAgentRun["status"][],
      siteId: value.siteId || undefined,
      range: value.range,
      startedAfter: presetHours ? new Date(Date.now() - presetHours * 60 * 60_000).toISOString() : value.from,
      startedBefore: value.to,
      sort: value.sort as SiteAgentRunAdminSort,
      limit: value.limit,
      offset: value.offset
    } satisfies SiteAgentRunAdminQuery
  };
}

function parseStatusList(value: string | undefined) {
  return [...new Set((value ?? "").split(",").map((status) => status.trim()).filter(Boolean))];
}
