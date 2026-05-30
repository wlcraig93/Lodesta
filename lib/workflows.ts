import type { LeadSubmission, SiteBundle, WorkflowDelivery, WorkflowDefinition } from "./models";
import { publicLeadSubmission } from "./lead-privacy";
import { validatePublicFetchUrl } from "./url-safety";

type WorkflowRecorder = (delivery: Omit<WorkflowDelivery, "id" | "createdAt">) => Promise<WorkflowDelivery>;

export async function executeFormSubmissionWorkflows(
  bundle: SiteBundle,
  submission: LeadSubmission,
  recordDelivery: WorkflowRecorder
) {
  const workflows = bundle.extensionModel.workflows.filter((workflow) => workflow.trigger === "form_submission");
  const deliveries: WorkflowDelivery[] = [];

  for (const workflow of workflows) {
    const delivery = await executeWorkflow(bundle, submission, workflow, recordDelivery);
    deliveries.push(delivery);
  }

  return deliveries;
}

async function executeWorkflow(
  bundle: SiteBundle,
  submission: LeadSubmission,
  workflow: WorkflowDefinition,
  recordDelivery: WorkflowRecorder
) {
  const base = {
    siteId: bundle.businessProfile.siteId,
    workflowId: workflow.id,
    submissionId: submission.id,
    destination: workflow.destination
  };

  try {
    if (workflow.destination === "email") {
      return recordDelivery({
        ...base,
        ...(await deliverEmail(bundle, submission, workflow))
      });
    }

    if (workflow.destination === "webhook") {
      return recordDelivery({
        ...base,
        ...(await deliverWebhook(bundle, submission, workflow))
      });
    }

    return recordDelivery({
      ...base,
      target: String(workflow.config.name ?? "CRM"),
      status: "skipped",
      message: "CRM workflow destination is configured as a placeholder for V1."
    });
  } catch (error) {
    return recordDelivery({
      ...base,
      target: workflowTarget(workflow, bundle),
      status: "failed",
      message: "Workflow delivery failed.",
      error: error instanceof Error ? error.message : "Unknown workflow error"
    });
  }
}

async function deliverEmail(bundle: SiteBundle, submission: LeadSubmission, workflow: WorkflowDefinition) {
  const target = workflowTarget(workflow, bundle);
  if (!target) {
    return {
      target,
      status: "skipped" as const,
      message: "Email workflow skipped because no recipient is configured."
    };
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = "Lodesta <notifications@mail.lodesta.com>";
  if (!apiKey) {
    return {
      target,
      status: "skipped" as const,
      message: "Email workflow logged only. Set RESEND_API_KEY to send notification emails."
    };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: workflowTimeoutSignal(),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: target,
      subject: `New lead for ${bundle.businessProfile.name}`,
      text: leadSummaryText(bundle, submission)
    })
  });

  return {
    target,
    status: response.ok ? ("sent" as const) : ("failed" as const),
    responseStatus: response.status,
    message: response.ok ? "Lead notification email sent." : "Lead notification email request failed.",
    error: response.ok ? undefined : await response.text().catch(() => undefined)
  };
}

async function deliverWebhook(bundle: SiteBundle, submission: LeadSubmission, workflow: WorkflowDefinition) {
  const target = workflowTarget(workflow, bundle);
  if (!target) {
    return {
      target,
      status: "skipped" as const,
      message: "Webhook workflow skipped because no URL is configured."
    };
  }
  const safeTarget = await validatePublicFetchUrl(target);
  if (!safeTarget.ok) {
    return {
      target,
      status: "failed" as const,
      message: "Webhook delivery blocked by URL safety guardrails.",
      error: safeTarget.error
    };
  }

  const response = await fetch(safeTarget.url, {
    method: "POST",
    signal: workflowTimeoutSignal(),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "form_submission",
      siteId: bundle.businessProfile.siteId,
      siteName: bundle.businessProfile.name,
      submission: publicLeadSubmission(submission)
    })
  });

  return {
    target,
    status: response.ok ? ("sent" as const) : ("failed" as const),
    responseStatus: response.status,
    message: response.ok ? "Lead webhook delivered." : "Lead webhook request failed.",
    error: response.ok ? undefined : await response.text().catch(() => undefined)
  };
}

function workflowTarget(workflow: WorkflowDefinition, bundle: SiteBundle) {
  const configured = workflow.config.to ?? workflow.config.url ?? workflow.config.target;
  if (typeof configured === "string" && configured.trim()) return configured.trim();
  if (workflow.destination === "email") return bundle.businessProfile.email;
  return undefined;
}

function leadSummaryText(bundle: SiteBundle, submission: LeadSubmission) {
  return [
    `New lead for ${bundle.businessProfile.name}`,
    `Form: ${submission.formId}`,
    `Submitted: ${submission.submittedAt}`,
    submission.sourceUrl ? `Source: ${submission.sourceUrl}` : undefined,
    "",
    JSON.stringify(submission.payload, null, 2)
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function workflowTimeoutSignal() {
  return AbortSignal.timeout(workflowTimeoutMs());
}

function workflowTimeoutMs() {
  const parsed = Number(process.env.LODESTA_WORKFLOW_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return 5000;
  return Math.min(Math.max(Math.trunc(parsed), 1000), 30000);
}
