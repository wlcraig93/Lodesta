export function websiteSetupOwnerInstruction(sourceUrl: string) {
  return `Create a website for my business using ${sourceUrl}.`;
}

export function websiteSetupHostname(sourceUrl: string) {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return sourceUrl;
  }
}
