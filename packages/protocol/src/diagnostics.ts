const fields = new Set(
  "connectionId role device id commandId method threadId runtimeId epoch seq revision baseRevision bytes elapsedMs latencyMs bufferedBytes closeCode errorCode attempt online foreground reason url activeTurnId status cursor duplicate stage port version pid kind lastReceivedAt count phase".split(
    " "
  )
);
/** Only operational metadata enters logs. Payloads and credentials never do. */
export function diagnosticDetails(details: Record<string, unknown> = {}) {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details)) {
    if (
      !fields.has(key) ||
      (!["string", "number", "boolean"].includes(typeof value) &&
        value !== null)
    )
      continue;
    safe[key] =
      typeof value === "string"
        ? (key === "url"
            ? value
                .replace(/[?#].*$/, "")
                .replace(/\/\/[^/@]+@/, "//[redacted]@")
            : value
          ).slice(0, 300)
        : (value as number | boolean | null);
  }
  return safe;
}
export function diagnosticError(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[A-Z][A-Z0-9_]{1,80}$/.test(code))
    return code;
  const text = error instanceof Error ? error.message : String(error);
  return /^[A-Z][A-Z0-9_]{1,80}$/.test(text)
    ? text
    : error instanceof Error
    ? error.name
    : "Error";
}
