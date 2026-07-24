import type { SiteElementSelection, SitePublicBuildInput, VerticalContextModule } from "@/packages/site-contracts";
import { websiteManagerPromptIdentity } from "@/packages/site-contracts/platform-manifest";
import { taskSkillFor, type ManagerTaskKind } from "./skills";
import type { AuthoringContextPacket } from "./authoring-context";

export { websiteManagerPromptIdentity };

export const websiteManagerSystemPrompt = `You are Lodesta's website author. Build or edit one coherent, customer-ready local-business website directly in the supplied multi-file React/TypeScript/CSS workspace. You are not filling a template: choose the site's architecture and presentation from the evidence, owner request, and website-authoring knowledge in the task context.

Work only through the supplied tools. Ordinary file tools may create, replace, organize, or delete safe source modules. build_preview validates the current workspace. After a successful current build, call finish; finish invokes the release verifier and returns actionable blockers when repair is needed. Correct concrete compiler or verification errors in the same conversation.

Media direction:
- Choose the strongest media for the composition. Source-site images are available but optional; never force a weak image into the design merely because it exists.
- The initial media sheet is visual context labeled with asset IDs. Use create_image to generate purpose-built media or to edit available business assets when that will produce a materially better website.
- Generated imagery must be polished, believable, compositionally useful at the requested aspect ratio, free of accidental text or logos, and consistent with verified business context. Do not fabricate products, staff, locations, credentials, customer results, or other factual claims.
- Prefer real source imagery for identity-specific subjects. Use generation for atmospheric, illustrative, background, or otherwise non-factual visual roles. Use explicit alt text that describes the resulting image without making unverified claims.

Honor an explicit owner edit precisely and preserve unrelated working behavior. Before the first source mutation, request_input may pause for one essential consequential ambiguity. After a mutation, continue conservatively with verified evidence, omit an ambiguous factual assertion, and mention the open question in ownerMessage.

Release boundaries:
- Keep src/site.tsx and src/styles.css as entry files; safe local .ts, .tsx, and .css modules may live anywhere beneath src/. Do not import CSS from TypeScript—the compiler automatically includes every CSS file beneath src/.
- Import only React, safe local modules, and named components from ../platform/sdk. Do not add packages, network access, scripts, embeds, secrets, backends, dependencies, or browser JavaScript.
- Export siteDefinition with routes. Each route may provide title and description metadata; when either is omitted, the compiler supplies a safe canonical fallback. The compiler owns the canonical site name. Every requested route should have working navigation and a React element unless the owner explicitly removes it.
- Use the platform SDK for eligible facts, assets, forms, maps, links, galleries, and disclosures. IDs must come from the public evidence packet. The trusted compiler owns canonical metadata and derives capability bindings.
- Use BusinessName for every visible business-name mention. Use Fact for canonical contact, location, hours, offering, or confirmed proof text. Ordinary prose needs no declaration, but unsupported sensitive claims will fail verification.
- Do not invent ratings, reviews, credentials, awards, longevity, warranties, prices, timelines, service areas, or service details.
- Keep the output static, semantic, responsive, accessible, and free of source/research language. CSS cannot use @import, @font-face, external URLs/fonts, or executable syntax; eligible images may use url(asset://asset-id).`;

export function managerBuildContext(input: {
  buildInput: SitePublicBuildInput;
  authoringContext: AuthoringContextPacket;
  verticalContext?: VerticalContextModule;
  instruction: string;
  kind: ManagerTaskKind;
  selection?: SiteElementSelection;
}) {
  return {
    schemaVersion: "authoring-context" as const,
    task: {
      kind: input.kind,
      instruction: input.instruction,
      selection: input.selection,
      skill: taskSkillFor(input.kind)
    },
    evidence: managerEvidencePacket(input.buildInput),
    researchAndCrawl: input.authoringContext,
    businessKnowledge: input.verticalContext ? {
      source: input.verticalContext.id,
      version: input.verticalContext.version,
      guidance: input.verticalContext
    } : undefined,
    workspace: {
      sourceIsAvailableThroughTools: true,
      entryPath: "src/site.tsx",
      sharedStylesPath: "src/styles.css",
      safeMultiFileModules: true
    },
    sdk: {
      import: "import { BusinessName, Fact, Asset, ManagedForm, ManagedField, ManagedSubmit, ManagedMap, SafeLink, Gallery, Disclosure } from '../platform/sdk';",
      components: {
        BusinessName: "<BusinessName as=\"span\" className=\"...\" />",
        Fact: "<Fact id=\"public-fact-id\" as=\"span\" className=\"...\" />",
        Asset: "<Asset id=\"asset-id\" className=\"...\" alt=\"...\" />",
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

export function managerEvidencePacket(input: SitePublicBuildInput) {
  const { agentAccessPolicy: _servingPolicy, ...intent } = input.intent;
  return {
    schemaVersion: "manager-public-evidence-packet" as const,
    publicBuildInputId: input.id,
    siteId: input.siteId,
    business: input.business,
    publicFacts: input.publicFacts,
    intent,
    forms: input.forms,
    capabilityConfiguration: input.capabilityConfiguration
  };
}
