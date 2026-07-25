/**
 * Client-side required-field checks for Lodesta product forms that opt out of
 * native validation with `noValidate`, so the product renders its own inline
 * error instead of the browser's validation bubble.
 *
 * Deliberately separate from `lib/form-validation.ts`, which validates
 * submissions against a `FormDefinition` on generated customer sites and is
 * boundary-sensitive.
 */

type ValidatableField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function hasValue(field: ValidatableField) {
  if (field instanceof HTMLInputElement && field.type === "file") {
    return Boolean(field.files?.length);
  }
  return field.value.trim().length > 0;
}

/** First required-but-empty control in a form, or undefined when all are filled. */
export function firstMissingRequired(form: HTMLFormElement) {
  for (const element of Array.from(form.elements)) {
    const field = element instanceof HTMLInputElement
      || element instanceof HTMLSelectElement
      || element instanceof HTMLTextAreaElement
      ? element
      : undefined;
    if (!field || !field.required || field.disabled) continue;
    if (!hasValue(field)) return field;
  }
  return undefined;
}

/** Human label for a control, preferring the text of its wrapping label. */
export function describeField(field: ValidatableField) {
  const label = field.closest("label");
  const ownText = label
    ? Array.from(label.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ")
        .trim()
    : "";
  const placeholder = field instanceof HTMLInputElement ? field.placeholder : "";
  return (ownText || field.getAttribute("aria-label") || placeholder || "this field").toLowerCase();
}

/** Inline message for a required control the owner left empty. */
export function missingRequiredMessage(field: ValidatableField) {
  const noun = describeField(field);
  if (field instanceof HTMLInputElement && field.type === "file") return `Choose ${noun}.`;
  return `Enter ${noun}.`;
}
