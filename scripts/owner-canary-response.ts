// Next's canonical trailing-slash redirect preserves POST with 308. A browser
// observer sees that intermediate response as well as the final API response;
// fetch itself follows it. Only the final response represents the operation.
export function isFinalOwnerCanaryPostResponse(
  response: { url(): string; status(): number; request(): { method(): string } },
  path: string,
  expectedOrigin: string
) {
  const status = response.status();
  const url = new URL(response.url());
  return url.origin === expectedOrigin && url.pathname.replace(/\/$/, "") === path
    && response.request().method() === "POST"
    && status >= 200 && (status < 300 || status >= 400);
}
