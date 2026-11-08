import type { OpenCodeClient } from "@opencode/client/promise"

const MEDIA_REF = /^media:([0-9a-f]{64})$/u

export function mediaHashFromUri(uri: string | undefined): string | undefined {
  if (!uri) return undefined
  return MEDIA_REF.exec(uri)?.[1]
}

export type MediaCache = {
  peek(uri: string): string | undefined
  load(uri: string, mime?: string, signal?: AbortSignal): Promise<string | undefined>
  dispose(): void
}

export const MEDIA_CACHE_MAX_ENTRIES = 128
export const MEDIA_CACHE_MAX_BYTES = 128 * 1024 * 1024

type MediaCacheOptions = { maxEntries?: number; maxBytes?: number }
type Entry = { url: string; bytes: number }

/** Keeps a byte-bounded LRU of object URLs for one server connection. */
export function createMediaCache(
  getApi: () => Pick<OpenCodeClient, "experimental">,
  options: MediaCacheOptions = {},
): MediaCache {
  const urls = new Map<string, Entry>()
  const inflight = new Map<string, Promise<string | undefined>>()
  const maxEntries = Math.max(1, options.maxEntries ?? MEDIA_CACHE_MAX_ENTRIES)
  const maxBytes = Math.max(1, options.maxBytes ?? MEDIA_CACHE_MAX_BYTES)
  let retainedBytes = 0
  let disposed = false

  const remove = (hash: string) => {
    const entry = urls.get(hash)
    if (!entry) return
    urls.delete(hash)
    retainedBytes -= entry.bytes
    URL.revokeObjectURL(entry.url)
  }

  const touch = (hash: string) => {
    const entry = urls.get(hash)
    if (!entry) return undefined
    urls.delete(hash)
    urls.set(hash, entry)
    return entry.url
  }

  const trim = (keep: string) => {
    while (urls.size > maxEntries || retainedBytes > maxBytes) {
      const oldest = urls.keys().next().value
      // A single accepted attachment may be larger than a custom/test budget. Keep
      // that one usable, but never retain older media beside it.
      if (oldest === undefined || (oldest === keep && urls.size === 1)) return
      remove(oldest)
    }
  }

  const fetchObjectUrl = (hash: string, mime: string) =>
    getApi()
      .experimental.media.get({ hash })
      .then((bytes) => {
        if (disposed) return undefined
        const cached = touch(hash)
        if (cached) return cached
        const data = new Uint8Array(bytes)
        const url = URL.createObjectURL(new Blob([data], { type: mime || "application/octet-stream" }))
        urls.set(hash, { url, bytes: data.byteLength })
        retainedBytes += data.byteLength
        trim(hash)
        return url
      })
      .finally(() => inflight.delete(hash))

  return {
    peek(uri) {
      const hash = mediaHashFromUri(uri)
      return disposed || !hash ? undefined : touch(hash)
    },
    load(uri, mime = "application/octet-stream", signal) {
      const hash = mediaHashFromUri(uri)
      if (disposed || signal?.aborted) return Promise.resolve(undefined)
      if (!hash) return Promise.resolve(uri)
      const cached = touch(hash)
      if (cached) return Promise.resolve(cached)
      const pending = inflight.get(hash) ?? fetchObjectUrl(hash, mime)
      inflight.set(hash, pending)
      if (!signal) return pending
      return new Promise<string | undefined>((resolve, reject) => {
        const onAbort = () => resolve(undefined)
        signal.addEventListener("abort", onAbort, { once: true })
        pending.then(
          (url) => {
            signal.removeEventListener("abort", onAbort)
            resolve(signal.aborted ? undefined : url)
          },
          (error) => {
            signal.removeEventListener("abort", onAbort)
            if (signal.aborted) resolve(undefined)
            else reject(error)
          },
        )
      })
    },
    dispose() {
      disposed = true
      inflight.clear()
      urls.forEach((entry) => URL.revokeObjectURL(entry.url))
      urls.clear()
      retainedBytes = 0
    },
  }
}
