import { z } from "zod";
import {
  defaultProspectCandidateFilters,
  prospectExplorerFieldKeys,
  prospectExplorerFields,
  prospectExplorerOperatorsFor,
  prospectFilterNeedsValue,
  prospectFilterOperators,
  type ProspectCandidateFilter,
  type ProspectCandidateQuery
} from "./explorer";

const prospectCandidateFilterSchema = z.object({
  field: z.enum(prospectExplorerFieldKeys),
  operator: z.enum(prospectFilterOperators),
  value: z.string().trim().max(500).optional()
}).superRefine((filter, context) => {
  const field = prospectExplorerFields[filter.field];
  if (!prospectExplorerOperatorsFor(filter.field).includes(filter.operator)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["operator"], message: `${filter.operator} is not valid for ${field.label}.` });
  }
  if (prospectFilterNeedsValue(filter.operator) && !filter.value) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: `${field.label} requires a value.` });
    return;
  }
  if (!filter.value) return;
  if (field.kind === "number" && !Number.isFinite(Number(filter.value))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: `${field.label} requires a number.` });
  }
  if (field.kind === "date" && Number.isNaN(Date.parse(filter.value))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: `${field.label} requires a date.` });
  }
  if (field.options && !field.options.some((option) => option.value === filter.value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: `${filter.value} is not valid for ${field.label}.` });
  }
});

export const prospectCandidateQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  filters: z.array(prospectCandidateFilterSchema).max(20).default([]),
  sortBy: z.enum(prospectExplorerFieldKeys).default("business_name"),
  sortDirection: z.enum(["asc", "desc"]).default("asc"),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(250).default(100)
});

export function parseProspectCandidateQuery(
  params: URLSearchParams,
  { defaultToPending = false }: { defaultToPending?: boolean } = {}
) {
  const fields = params.getAll("field");
  const operators = params.getAll("operator");
  const values = params.getAll("value");
  const filters: ProspectCandidateFilter[] = fields.map((field, index) => ({
    field: field as ProspectCandidateFilter["field"],
    operator: operators[index] as ProspectCandidateFilter["operator"],
    value: values[index] || undefined
  }));
  const useDefaultFilters = defaultToPending && !params.has("view") && fields.length === 0;

  return prospectCandidateQuerySchema.safeParse({
    search: params.get("q") || undefined,
    filters: useDefaultFilters ? defaultProspectCandidateFilters() : filters,
    sortBy: params.get("sort") || undefined,
    sortDirection: params.get("direction") || undefined,
    offset: params.get("offset") || undefined,
    limit: params.get("limit") || undefined
  });
}

export function prospectCandidateQueryParams(query: ProspectCandidateQuery, view = "custom") {
  const params = new URLSearchParams();
  if (query.search) params.set("q", query.search);
  params.set("view", view);
  for (const filter of query.filters ?? []) {
    params.append("field", filter.field);
    params.append("operator", filter.operator);
    params.append("value", filter.value ?? "");
  }
  if (query.sortBy && query.sortBy !== "business_name") params.set("sort", query.sortBy);
  if (query.sortDirection && query.sortDirection !== "asc") params.set("direction", query.sortDirection);
  if (query.offset) params.set("offset", String(query.offset));
  if (query.limit && query.limit !== 100) params.set("limit", String(query.limit));
  return params;
}
