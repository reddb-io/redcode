const SECRET_KEY =
  /(?:^|[._-])(?:auth|authentication|authorization|proxy.authorization|cookie|set.cookie|password|passwd|passphrase|secret|secret.?key|token|api.?key|access.?token|refresh.?token|client.?secret|credentials?)$/i

export function redact(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
  if (SECRET_KEY.test(key)) return "[redacted]"
  if (typeof value === "string") return text(value)
  if (value instanceof Error) return text(value.stack ?? value.message)
  if (!value || typeof value !== "object") return value
  if (seen.has(value)) return "[Circular]"
  seen.add(value)
  if (Array.isArray(value)) return value.map((entry) => redact(entry, "", seen))
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value
  return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, redact(entry, name, seen)]))
}

export function text(value: string) {
  return value
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(?:sk-|ghp_|github_pat_|xox[baprs]-|ya29\.|gsk_|xai-)[A-Za-z0-9._-]+/g, "[redacted]")
    .replace(/\b(?:AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,})\b/g, "[redacted]")
    .replace(/\/\/[^/@\s]+@/g, "//[redacted]@")
    .replace(
      /([?&](?:api[_-]?key|token|access[_-]?token|refresh[_-]?token|password|secret)=)[^&#\s"']+/gi,
      "$1[redacted]",
    )
    .replace(
      /(["']?(?:authorization|proxy-authorization|cookie|set-cookie)["']?\s*[:=]\s*)[^\r\n]*/gi,
      "$1[redacted]",
    )
    .replace(
      /(["']?(?:password|passwd|passphrase|api[_-]?key|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi,
      "$1[redacted]",
    )
}

export * as Redact from "./redact"
