export type LodestaExecutionRole = "web" | "site-authoring-worker" | "release";
export type LodestaRepositoryMode = "local" | "supabase";

const executionRoles = new Set<LodestaExecutionRole>(["web", "site-authoring-worker", "release"]);

export function isNonLoopbackHttpsOrigin(source: string | undefined) {
  if (!source) return false;
  try {
    const url = new URL(source);
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function hasHostedReleaseIdentity(environment: NodeJS.ProcessEnv = process.env) {
  return environment.NODE_ENV === "production"
    && /^[a-f0-9]{40}$/.test(environment.LODESTA_RELEASE_GIT_SHA?.trim() ?? "")
    && isNonLoopbackHttpsOrigin(environment.LODESTA_APP_ORIGIN);
}

export function executionRole(environment: NodeJS.ProcessEnv = process.env): LodestaExecutionRole | undefined {
  const role = environment.LODESTA_EXECUTION_ROLE?.trim();
  return executionRoles.has(role as LodestaExecutionRole) ? role as LodestaExecutionRole : undefined;
}

export function hasHostedExecutionAuthority(
  requiredRole: LodestaExecutionRole,
  environment: NodeJS.ProcessEnv = process.env
) {
  return hasHostedReleaseIdentity(environment) && executionRole(environment) === requiredRole;
}

export function assertHostedExecutionAuthority(
  requiredRole: LodestaExecutionRole,
  operation: string,
  environment: NodeJS.ProcessEnv = process.env
) {
  if (!hasHostedExecutionAuthority(requiredRole, environment)) {
    throw new Error(`hosted_execution_authority_required:${requiredRole}:${operation}`);
  }
}

export function configuredRepositoryMode(environment: NodeJS.ProcessEnv = process.env): LodestaRepositoryMode {
  const configured = environment.LODESTA_REPOSITORY?.trim();
  if (configured === "local" || configured === "supabase") return configured;
  if (configured) throw new Error(`invalid_lodesta_repository:${configured}`);
  return hasHostedReleaseIdentity(environment) ? "supabase" : "local";
}
