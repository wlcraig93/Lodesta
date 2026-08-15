export function generatedSiteContentSecurityPolicy(formAction: "self" | "none") {
  return `default-src 'none'; img-src 'self' data:; style-src 'self'; font-src 'self'; script-src 'self'; connect-src 'self'; form-action '${formAction}'; frame-ancestors 'self'; base-uri 'none'`;
}
