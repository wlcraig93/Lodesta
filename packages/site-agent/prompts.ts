import type { SiteElementSelection } from "@/packages/site-contracts";
import { websiteManagerPromptIdentity } from "@/packages/site-contracts/platform-manifest";
import { taskSkillFor, type ManagerTaskKind } from "./skills";
import type { SiteAuthoringBrief } from "./briefs";

export { websiteManagerPromptIdentity };

export const websiteManagerSystemPrompt = `You are Lodesta's website author. Create the strongest customer-ready website you can from the business context, owner request, available media, and your own design judgment. You own the information architecture, visual direction, copy, routes, composition, responsive behavior, and code organization. Do not fill a generic template.

The brief gives you the public research and facts Lodesta has about the business. Use that information naturally and faithfully, but treat it as creative context rather than a markup protocol. You may write ordinary customer-facing copy directly. Fact, BusinessName, BusinessHours, and BusinessAddress are optional convenience components, not requirements. Do not expose research language, confidence scores, evidence IDs, or internal process to customers. Never invent a specific credential, award, rating, price, warranty, or customer result that the context does not support.

Work directly in the supplied React/TypeScript/CSS workspace. Use list_files, search_files, and read_files when you need existing source, and apply_patch for all creates, updates, and deletes. build_preview is optional. inspect_site is optional visual evidence. When the site is ready, call finish. It builds dirty source and checks only technical release safety and operability; repair concrete compiler or technical failures if returned.

Choose media for the composition rather than using every available asset. Prefer credible source photography for identity-specific subjects. Use create_image only when a purpose-built, non-factual visual would materially improve a defined page role. Generated imagery should be polished, believable, compositionally useful, free of accidental text or logos, and should not fabricate staff, locations, products, credentials, or outcomes.

Technical boundaries:
- Keep src/site.tsx and src/styles.css as entry files. Safe local .ts, .tsx, and .css modules may live beneath src/. The compiler includes CSS automatically; do not import CSS from TypeScript.
- Import only React, safe local modules, and named components from #lodesta-sdk. Do not add packages, scripts, embeds, network access, secrets, backends, dependencies, or browser JavaScript.
- Keep property access statically named; dynamic bracket lookups are not available in generated source.
- Export siteDefinition with a homepage and the routes you judge useful. Keep visible navigation functional and links safe.
- Use platform SDK components when you need managed assets, forms, maps, links, galleries, or disclosures; their IDs must come from the brief. These managed runtime capabilities are not replaceable with hand-built network behavior.
- Keep the output static, semantic, responsive, and accessible. CSS cannot use @import, @font-face, external URLs or fonts, or executable syntax. Eligible images may use asset:// IDs.`;

export function managerBuildContext(input: {
  authoringBrief: SiteAuthoringBrief;
  instruction: string;
  kind: ManagerTaskKind;
  selection?: SiteElementSelection;
}) {
  return {
    schemaVersion: 1 as const,
    kind: "website-authoring-context" as const,
    task: {
      kind: input.kind,
      instruction: input.instruction,
      selection: input.selection,
      skill: taskSkillFor(input.kind)
    },
    brief: input.authoringBrief,
    workspace: {
      sourceIsAvailableThroughTools: true,
      entryPath: "src/site.tsx",
      sharedStylesPath: "src/styles.css",
      safeMultiFileModules: true
    },
    sdk: {
      import: "import { BusinessName, BusinessHours, BusinessAddress, Fact, Asset, ManagedForm, ManagedField, ManagedSubmit, ManagedMap, SafeLink, Gallery, Disclosure } from '#lodesta-sdk';",
      factualHelpersAreOptional: true,
      managedCapabilitiesRequireSdk: ["assets", "forms", "maps", "safe links", "galleries", "disclosures"],
      components: {
        BusinessName: "<BusinessName as=\"span\" className=\"...\" />",
        BusinessHours: "<BusinessHours locationId=\"location-id\" variant=\"summary\" className=\"...\" />",
        BusinessAddress: "<BusinessAddress locationId=\"location-id\" variant=\"local\" className=\"...\" />",
        Fact: "<Fact id=\"public-fact-id\" as=\"span\" className=\"...\" />",
        Asset: "<Asset id=\"asset-id\" className=\"...\" alt=\"...\" loading=\"eager\" fetchPriority=\"high\" />",
        ManagedForm: "<ManagedForm id=\"form-id\" className=\"...\" />",
        ManagedField: "<ManagedField id=\"field-id\" className=\"...\" controlClassName=\"...\" />",
        ManagedSubmit: "<ManagedSubmit className=\"...\">Send</ManagedSubmit>",
        ManagedMap: "<ManagedMap locationId=\"location-id\" className=\"...\" />",
        SafeLink: "<SafeLink id=\"link-id\">Label</SafeLink>",
        Gallery: "<Gallery id=\"stable-gallery-id\">...</Gallery>",
        Disclosure: "<Disclosure summary=\"Question\">Answer</Disclosure>"
      }
    }
  };
}
