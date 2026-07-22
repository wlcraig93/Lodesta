import { z } from "zod";

export async function parseJsonResponse<T extends z.ZodTypeAny>(response: Response, schema: T): Promise<z.infer<T>> {
  const value: unknown = await response.json();
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("The server returned an invalid response.");
  return parsed.data;
}
