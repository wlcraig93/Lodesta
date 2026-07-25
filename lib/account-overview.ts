import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/client";
import { siteCapabilityRepository } from "@/packages/site-capabilities";
import {
  siteAgentRunSchema,
  siteVersionSchema,
  type PlatformSiteRecord
} from "@/packages/site-contracts";
import { sitePlatformRepository } from "@/packages/platform-data";
import { platformOperationsRepository } from "@/packages/platform-operations";

const ownerAccountSiteOverviewSchema = z.object({
  siteId: z.string().min(1),
  versions: z.array(siteVersionSchema),
  runs: z.array(siteAgentRunSchema).max(8),
  replyInquiryCount: z.number().int().nonnegative(),
  domainAttention: z.boolean(),
  openQueueCount: z.number().int().nonnegative()
}).strict();

const ownerAccountOverviewSchema = z.array(ownerAccountSiteOverviewSchema);

export type OwnerAccountSiteOverview = z.infer<typeof ownerAccountSiteOverviewSchema>;

export async function getOwnerAccountOverview(ownerUserId: string, sites: PlatformSiteRecord[]) {
  if (process.env.LODESTA_REPOSITORY !== "local") {
    const { data, error } = await getSupabaseAdminClient().rpc("owner_account_overview", {
      target_owner_user_id: ownerUserId
    });
    if (error) throw new Error(`Load owner account overview: ${error.message}`);
    return ownerAccountOverviewSchema.parse(data);
  }

  const queue = await sitePlatformRepository.listOperatorQueue();
  return Promise.all(sites.map(async (site): Promise<OwnerAccountSiteOverview> => {
    const [versions, runs, inquiries, domains] = await Promise.all([
      sitePlatformRepository.listSiteVersions(site.id),
      sitePlatformRepository.listRecentAgentRuns({ siteId: site.id, limit: 8 }),
      siteCapabilityRepository.listInquiries(site.id),
      platformOperationsRepository.listDomains(site.id)
    ]);
    return {
      siteId: site.id,
      versions,
      runs,
      replyInquiryCount: inquiries.filter((inquiry) =>
        inquiry.status === "new" || inquiry.status === "needs_reply"
      ).length,
      domainAttention: domains.some((domain) => domain.status === "attention_required"),
      openQueueCount: queue.filter((item) =>
        item.siteId === site.id && (item.status === "open" || item.status === "in_review")
      ).length
    };
  }));
}
