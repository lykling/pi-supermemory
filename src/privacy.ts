/** Redact <private>...</private> blocks before content is sent to Supermemory. */
export function stripPrivateContent(content: string): string {
  return content.replace(/<private>[\s\S]*?<\/private>/gi, "[REDACTED]");
}

/** True when nothing except private markers remains. */
export function isFullyPrivate(content: string): boolean {
  const stripped = stripPrivateContent(content).trim();
  return stripped === "[REDACTED]" || stripped === "";
}
