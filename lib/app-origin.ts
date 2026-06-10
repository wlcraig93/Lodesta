export const appOriginEnvName = "LODESTA_APP_ORIGIN";
export const defaultLocalAppOrigin = "http://localhost:4330";

export function configuredAppOrigin() {
  const value = process.env[appOriginEnvName]?.trim();
  if (!value) return undefined;

  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

export function configuredAppOriginOrDefault() {
  return configuredAppOrigin() ?? defaultLocalAppOrigin;
}

export function appOriginFromRequest(request: Request) {
  return configuredAppOrigin() ?? new URL(request.url).origin;
}
