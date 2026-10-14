const fallback = () => {
  const c = globalThis.crypto
  if (!c || typeof c.getRandomValues !== "function") return Math.random().toString(16).slice(2)

  // getRandomValues remains available on LAN HTTP where randomUUID is absent.
  const bytes = c.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .replace(/^(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})$/, "$1-$2-$3-$4-$5")
}

export function uuid() {
  const c = globalThis.crypto

  if (!c || typeof c.randomUUID !== "function") return fallback()

  if (typeof globalThis.isSecureContext === "boolean" && !globalThis.isSecureContext) return fallback()

  try {
    return c.randomUUID()
  } catch {
    return fallback()
  }
}
