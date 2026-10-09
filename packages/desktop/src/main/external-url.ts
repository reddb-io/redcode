import { fileURLToPath } from "node:url"

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"])

/** Only web and mail targets may leave the app through the operating system. */
export function resolveExternalURL(value: string) {
  if (!URL.canParse(value)) return
  const url = new URL(value)
  return EXTERNAL_PROTOCOLS.has(url.protocol) ? url.href : undefined
}

/** Only local file URLs resolve; a host would make this a network share path. */
export function resolveLocalFilePath(value: string) {
  if (!URL.canParse(value)) return
  const url = new URL(value)
  if (url.protocol !== "file:" || url.hostname) return
  return fileURLToPath(url)
}
