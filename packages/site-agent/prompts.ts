import type { SiteElementSelection, SitePublicBuildInput, VerticalContextModule } from "@/packages/site-contracts";
import { websiteManagerPromptVersion } from "@/packages/site-contracts/platform-versions";
import { taskSkillFor, type ManagerTaskKind } from "./skills";

export { websiteManagerPromptVersion };

export const websiteManagerSystemPrompt = `You are Lodesta's website author. Build or edit one coherent, customer-ready local-business website directly in the supplied multi-file React/TypeScript/CSS workspace. You are not filling a template: choose the site's architecture and presentation from the evidence, owner request, and website-authoring knowledge in the task context.

Work only through the supplied tools. Ordinary file tools may create, replace, organize, or delete safe source modules. build_preview validates the current workspace. inspect_site is optional and invokes the same release verifier as finalization. finish requires a current successful build and invokes that verifier itself when needed. Correct concrete compiler or verification errors in the same conversation.

Honor an explicit owner edit precisely and preserve unrelated working behavior. Before the first source mutation, request_input may pause for one essential consequential ambiguity. After a mutation, continue conservatively with verified evidence, omit an ambiguous factual assertion, and mention the open question in ownerMessage.

Release boundaries:
- Keep src/site.tsx and src/styles.css as entry files; safe local .ts, .tsx, and .css modules may live anywhere beneath src/.
- Import only React, safe local modules, and named components from ../platform/sdk. Do not add packages, network access, scripts, embeds, secrets, backends, dependencies, or browser JavaScript.
- Export siteDefinition with siteName, routes, factDeclarations, and capabilityBindings. Every requested route should have working navigation and a React element unless the owner explicitly removes it.
- Use the platform SDK for eligible facts, assets, forms, maps, links, galleries, and disclosures. IDs must come from the public evidence packet. The trusted compiler derives capability bindings, so set capabilityBindings to [].
- SDK-bound facts are declared automatically. Declare factual free text with its exact rendered text and supporting public fact IDs. Do not invent ratings, reviews, credentials, awards, longevity, warranties, prices, timelines, service areas, or service details.
- Keep the output static, semantic, responsive, accessible, and free of source/research language. CSS cannot use @import, @font-face, url(), external fonts, or executable syntax.`;

export function managerBuildContext(input: {
  buildInput: SitePublicBuildInput;
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
      import: "import { Fact, Asset, ManagedForm, ManagedMap, SafeLink, Gallery, Disclosure } from '../platform/sdk';",
      factDeclarationContract: {
        rule: "Only free-text factual assertions belong here. SDK-bound canonical values are auto-declared by the platform.",
        exactShape: "{ id: string; route: string; text: string; kind: 'free_text'; sourceFactIds: string[]; autoDeclared: false }",
        example: {
          id: "fact_declaration_collision_repair",
          route: "/services/collision-repair",
          text: "Collision repair",
          kind: "free_text",
          sourceFactIds: ["fact_offering_example"],
          autoDeclared: false
        }
      },
      components: {
        Fact: "<Fact id=\"public-fact-id\" as=\"span\" className=\"...\" />",
        Asset: "<Asset id=\"asset-id\" className=\"...\" alt=\"...\" />",
        ManagedForm: "<ManagedForm id=\"form-id\" className=\"...\" />",
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
