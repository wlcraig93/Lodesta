import { z } from "zod";

export const freshIntakeRequestSchema = z.object({
  url: z.string().trim().min(1),
  prompt: z.string().trim().min(3).optional(),
  telemetrySource: z.enum(["admin_console"]).optional()
});

export type FreshIntakeRequest = z.infer<typeof freshIntakeRequestSchema>;
