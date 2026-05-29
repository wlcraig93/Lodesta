import { crawlUrl } from "./crawler";
import { createSiteFromInput, type IntakeInput } from "./intake";
import { createOpenAiMockupArtifacts } from "./image-generation";
import { createOpenAiGenerationPlanning } from "./openai-generation";
import { gatherPublicPresenceSignals } from "./public-presence";
import { inspectUrlRender } from "./render-inspection";
import { assertPublicFetchUrl } from "./url-safety";
import { createOpenAiVisualQa } from "./visual-qa";
import { assertLaunchMarket } from "./launch-market";

export async function prepareIntakeInput(input: { url?: string; prompt?: string }): Promise<IntakeInput> {
  assertLaunchMarket(input);
  const safeUrl = input.url ? await assertPublicFetchUrl(input.url) : undefined;
  const [crawl, renderInspection] = safeUrl
    ? await Promise.all([
        crawlUrl(safeUrl),
        inspectUrlRender({ url: safeUrl, captureScreenshots: true })
      ])
    : [undefined, undefined];
  const publicPresence = await gatherPublicPresenceSignals({ ...input, url: safeUrl, crawl });
  assertLaunchMarket({ ...input, url: safeUrl, crawl, publicPresence });

  const deterministicBundle = createSiteFromInput({ ...input, url: safeUrl, crawl, renderInspection, publicPresence });
  const aiPlanning = await createOpenAiGenerationPlanning({
    bundle: deterministicBundle,
    sourceUrl: safeUrl,
    prompt: input.prompt,
    crawl,
    renderInspection
  });
  const plannedBundle = createSiteFromInput({ ...input, url: safeUrl, crawl, renderInspection, aiPlanning, publicPresence });
  const [mockupArtifacts, visualQa] = await Promise.all([
    createOpenAiMockupArtifacts({ bundle: plannedBundle }),
    createOpenAiVisualQa({ bundle: plannedBundle, renderInspection })
  ]);

  return {
    ...input,
    url: safeUrl,
    crawl,
    renderInspection,
    publicPresence,
    aiPlanning,
    mockupArtifacts,
    visualQa
  };
}
