import type { LeadSubmission, SiteBundle, WorkflowDelivery, WorkflowDefinition } from "./models";

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
  const from = process.env.WORKFLOW_FROM_EMAIL ?? "Lodesta <notifications@lodesta.example>";
  if (!apiKey) {
    return {
      target,
      status: "skipped" as const,
      message: "Email workflow logged only. Set RESEND_API_KEY to send notification emails."
    };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
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

  const response = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "form_submission",
      siteId: bundle.businessProfile.siteId,
      siteName: bundle.businessProfile.name,
      submission
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
