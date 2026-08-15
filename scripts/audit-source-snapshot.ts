import { sitePlatformRepository } from "@/packages/platform-data";
import { auditSourceSnapshotArchive } from "@/packages/site-platform/source-archive-audit";

const snapshotId = process.argv.find((argument) => argument.startsWith("--snapshot-id="))?.slice("--snapshot-id=".length);
if (!snapshotId) throw new Error("Usage: npm run audit:source-snapshot -- --snapshot-id=<source snapshot ID>");

const audit = await auditSourceSnapshotArchive({ snapshotId, repository: sitePlatformRepository });
console.log(JSON.stringify(audit, null, 2));
if (audit.status === "storage_unavailable") process.exitCode = 2;
if (audit.status === "integrity_failed") process.exitCode = 1;
