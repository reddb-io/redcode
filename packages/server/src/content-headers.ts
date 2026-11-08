export * as ContentHeaders from "./content-headers"

import path from "node:path"

// Raw media opened as a page stays inert on the server's authenticated origin.
export const CONTENT_SECURITY_POLICY = "default-src 'none'; img-src 'self'; media-src 'self'; sandbox"

const TEXT_TYPE = "text/plain; charset=utf-8"

/** Headers for raw file bytes: always a download, never rendered as a page on the server's origin. */
export function download(input: { readonly path?: string; readonly mime: string }) {
  return {
    "content-type": /^(text\/html|text\/javascript|application\/(x-)?javascript)\b|[/+]xml\b/i.test(input.mime)
      ? TEXT_TYPE
      : input.mime,
    "content-disposition": disposition(input.path === undefined ? "" : path.basename(input.path)),
    "content-security-policy": CONTENT_SECURITY_POLICY,
    "x-content-type-options": "nosniff",
  }
}

/** RFC 6266 ASCII fallback plus an exact UTF-8 filename. */
export function disposition(name: string) {
  if (name === "") return "attachment"
  const fallback = name.replace(/[^\x20-\x7e]|["\\%]/g, "_")
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}
