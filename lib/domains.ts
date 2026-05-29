export type DomainVerification = {
  type: "cname" | "txt" | "http";
  value: string;
  note: string;
  providerHostnameId?: string;
  configured: boolean;
};

export type DomainProviderStatus = {
  status: "pending" | "active" | "failed";
  providerStatus?: string;
  sslStatus?: string;
  verification?: DomainVerification;
  note: string;
};

type RegisterCustomHostnameInput = {
  hostname: string;
};

type CloudflareCustomHostnameResponse = {
  success?: boolean;
  errors?: Array<{ message?: string }>;
  result?: {
    id?: string;
    hostname?: string;
    status?: string;
    verification_errors?: string[];
    ownership_verification?: {
      type?: string;
      name?: string;
      value?: string;
    };
    ssl?: {
      status?: string;
      validation_errors?: Array<{ message?: string }>;
      validation_records?: Array<{
        txt_name?: string;
        txt_value?: string;
        http_url?: string;
        http_body?: string;
        status?: string;
      }>;
    };
  };
};

export async function registerCustomHostname(input: RegisterCustomHostnameInput): Promise<DomainVerification> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const fallbackTarget = process.env.CLOUDFLARE_FALLBACK_ORIGIN ?? "customers.lodesta.example";

  if (!token || !zoneId) {
    return {
      type: "cname",
      value: fallbackTarget,
      configured: false,
      note: "Cloudflare for SaaS is not configured. Point a CNAME here in local mode; set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID for live custom hostnames."
    };
  }

  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      hostname: input.hostname,
      ssl: {
        method: "http",
        type: "dv",
        settings: {
          min_tls_version: "1.2"
        }
      }
    })
  });

  const payload = (await response.json().catch(() => null)) as CloudflareCustomHostnameResponse | null;
  if (!response.ok || payload?.success === false) {
    const message = payload?.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(message || `Cloudflare custom hostname failed with status ${response.status}`);
  }

  const verification = payload?.result?.ownership_verification;
  const sslRecord = payload?.result?.ssl?.validation_records?.[0];
  if (verification?.value) {
    return {
      type: verification.type === "txt" ? "txt" : "http",
      value: verification.value,
      providerHostnameId: payload?.result?.id,
      configured: true,
      note: verification.name ? `Create ${verification.type ?? "verification"} record at ${verification.name}.` : "Complete Cloudflare ownership verification."
    };
  }

  if (sslRecord?.txt_value) {
    return {
      type: "txt",
      value: sslRecord.txt_value,
      providerHostnameId: payload?.result?.id,
      configured: true,
      note: sslRecord.txt_name ? `Create TXT record at ${sslRecord.txt_name}.` : "Complete Cloudflare SSL validation."
    };
  }

  return {
    type: "cname",
    value: fallbackTarget,
    providerHostnameId: payload?.result?.id,
    configured: true,
    note: "Cloudflare custom hostname was created. Add the customer CNAME and wait for SSL validation."
  };
}

export async function refreshCustomHostnameStatus(input: {
  provider: "railway" | "cloudflare_for_saas";
  hostname: string;
  providerHostnameId?: string;
  verification?: DomainVerification;
}): Promise<DomainProviderStatus> {
  if (input.provider === "railway") {
    return {
      status: "active",
      verification: {
        ...(input.verification ?? fallbackVerification()),
        configured: true,
        note: "Railway/manual custom domain status is managed outside Cloudflare; mark active after DNS is configured."
      },
      note: "Railway/manual custom domain marked active."
    };
  }

  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!token || !zoneId || !input.providerHostnameId) {
    return {
      status: "pending",
      verification: input.verification,
      note: "Cloudflare status cannot be refreshed until CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID, and providerHostnameId are available."
    };
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames/${input.providerHostnameId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    }
  );
  const payload = (await response.json().catch(() => null)) as CloudflareCustomHostnameResponse | null;
  if (!response.ok || payload?.success === false) {
    const message = payload?.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(message || `Cloudflare custom hostname status failed with status ${response.status}`);
  }

  const providerStatus = payload?.result?.status;
  const sslStatus = payload?.result?.ssl?.status;
  const validationErrors = [
    ...(payload?.result?.verification_errors ?? []),
    ...(payload?.result?.ssl?.validation_errors
      ?.map((error) => error.message)
      .filter((message): message is string => Boolean(message)) ?? [])
  ];
  const status = mapCloudflareDomainStatus(providerStatus, sslStatus, validationErrors);
  const verification = verificationFromCloudflareResult(payload, input.verification);

  return {
    status,
    providerStatus,
    sslStatus,
    verification,
    note: cloudflareStatusNote(status, providerStatus, sslStatus, validationErrors)
  };
}

export function normalizeCustomHostname(value: string) {
  const trimmed = value.trim().toLowerCase();
  const hostname = trimmed.startsWith("http://") || trimmed.startsWith("https://")
    ? new URL(trimmed).hostname
    : trimmed.split("/")[0];

  if (!hostname || hostname.length > 253) {
    throw new Error("Enter a valid hostname, such as www.example.com.");
  }
  if (hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    throw new Error("Use a real customer domain, not localhost or an IP address.");
  }
  const labels = hostname.split(".");
  if (
    labels.length < 2 ||
    labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
  ) {
    throw new Error("Enter a valid hostname, such as www.example.com.");
  }
  return hostname;
}

function verificationFromCloudflareResult(
  payload: CloudflareCustomHostnameResponse | null,
  fallback: DomainVerification | undefined
): DomainVerification | undefined {
  const verification = payload?.result?.ownership_verification;
  const sslRecord = payload?.result?.ssl?.validation_records?.[0];
  const providerHostnameId = payload?.result?.id ?? fallback?.providerHostnameId;
  if (verification?.value) {
    return {
      type: verification.type === "txt" ? "txt" : "http",
      value: verification.value,
      providerHostnameId,
      configured: true,
      note: verification.name ? `Create ${verification.type ?? "verification"} record at ${verification.name}.` : "Complete Cloudflare ownership verification."
    };
  }
  if (sslRecord?.txt_value) {
    return {
      type: "txt",
      value: sslRecord.txt_value,
      providerHostnameId,
      configured: true,
      note: sslRecord.txt_name ? `Create TXT record at ${sslRecord.txt_name}.` : "Complete Cloudflare SSL validation."
    };
  }
  if (sslRecord?.http_body || sslRecord?.http_url) {
    return {
      type: "http",
      value: sslRecord.http_body ?? sslRecord.http_url ?? "",
      providerHostnameId,
      configured: true,
      note: sslRecord.http_url ? `Serve the HTTP validation body at ${sslRecord.http_url}.` : "Complete Cloudflare HTTP validation."
    };
  }
  return fallback ? { ...fallback, providerHostnameId } : undefined;
}

function mapCloudflareDomainStatus(
  providerStatus: string | undefined,
  sslStatus: string | undefined,
  errors: string[]
): DomainProviderStatus["status"] {
  if (errors.length > 0) return "failed";
  if (providerStatus === "active" && (!sslStatus || sslStatus === "active" || sslStatus === "backup_issued")) return "active";
  const failed = new Set([
    "blocked",
    "deleted",
    "inactive",
    "validation_timed_out",
    "issuance_timed_out",
    "deployment_timed_out",
    "deletion_timed_out",
    "expired"
  ]);
  if ((providerStatus && failed.has(providerStatus)) || (sslStatus && failed.has(sslStatus))) return "failed";
  return "pending";
}

function cloudflareStatusNote(status: DomainProviderStatus["status"], providerStatus?: string, sslStatus?: string, errors: string[] = []) {
  if (status === "active") return "Cloudflare custom hostname is active with a deployable certificate.";
  if (status === "failed") return errors.length ? `Cloudflare custom hostname failed: ${errors.join("; ")}` : "Cloudflare custom hostname failed validation or deployment.";
  return `Cloudflare custom hostname is still pending${providerStatus ? `; hostname=${providerStatus}` : ""}${sslStatus ? `; ssl=${sslStatus}` : ""}.`;
}

function fallbackVerification(): DomainVerification {
  return {
    type: "cname",
    value: process.env.CLOUDFLARE_FALLBACK_ORIGIN ?? "customers.lodesta.example",
    configured: false,
    note: "Point the customer hostname at the configured platform origin."
  };
}
