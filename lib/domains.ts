export type DomainVerification = {
  type: "cname" | "txt" | "http";
  value: string;
  note: string;
  providerHostnameId?: string;
  configured: boolean;
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
    verification_errors?: string[];
    ownership_verification?: {
      type?: string;
      name?: string;
      value?: string;
    };
    ssl?: {
      validation_records?: Array<{
        txt_name?: string;
        txt_value?: string;
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
