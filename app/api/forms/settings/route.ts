import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdminOrSiteOwner } from "@/lib/security";

const formFieldSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  type: z.enum(["text", "email", "phone", "textarea", "select"]),
  required: z.boolean().default(false),
  options: z.array(z.string().max(80)).optional()
});

const formSettingsSchema = z.object({
  siteId: z.string().min(1),
  formId: z.string().min(1),
  name: z.string().max(120).optional(),
  submitLabel: z.string().max(80).optional(),
  fields: z.array(formFieldSchema).min(1).max(12),
  notificationEmail: z.string().email().or(z.literal("")).optional(),
  webhookUrl: z.string().url().or(z.literal("")).optional()
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = formSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid form settings request", issues: parsed.error.issues }, { status: 400 });
  }

  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;

  const result = await repository.updateFormSettings(parsed.data);
  if (!result) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });

  return NextResponse.json({
    ok: true,
    form: result.form,
    workflows: result.workflows
  });
}
