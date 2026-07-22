import "./load-env";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { configuredR2MaintenanceS3 } from "../packages/site-artifacts/maintenance-store";

const auditAccessKey = process.env.LODESTA_R2_AUDIT_ACCESS_KEY_ID;
const maintenanceAccessKey = process.env.LODESTA_R2_MAINTENANCE_ACCESS_KEY_ID;
if (auditAccessKey && maintenanceAccessKey && auditAccessKey === maintenanceAccessKey) {
  throw new Error("R2 audit and maintenance credentials must be distinct tokens.");
}

const audit = configuredR2MaintenanceS3();
const maintenance = configuredR2MaintenanceS3({ write: true });
if (audit.buckets.artifact !== maintenance.buckets.artifact || audit.buckets.workspace !== maintenance.buckets.workspace) {
  throw new Error("R2 audit and maintenance credentials do not target the same canonical buckets.");
}

for (const [role, configured] of [["audit", audit], ["maintenance", maintenance]] as const) {
  for (const [store, bucket] of Object.entries(configured.buckets) as Array<["artifact" | "workspace", string]>) {
    try {
      await configured.client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
    } catch (error) {
      throw new Error(`${role} R2 credential cannot list the ${store} bucket ${bucket}: ${message(error)}`);
    }
  }
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  credentialsDistinct: true,
  buckets: audit.buckets,
  access: {
    audit: ["artifact:list", "workspace:list"],
    maintenance: ["artifact:list", "workspace:list"]
  }
})}\n`);

function message(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}
