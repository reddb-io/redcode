import { describe, expect, test } from "bun:test"
import { createMediaCache, mediaHashFromUri } from "./media"

const hash = "a".repeat(64)

describe("media cache", () => {
  test("recognizes only canonical content references", () => {
    expect(mediaHashFromUri(`media:${hash}`)).toBe(hash)
    expect(mediaHashFromUri(`media:${hash.toUpperCase()}`)).toBeUndefined()
    expect(mediaHashFromUri("https://example.test/file")).toBeUndefined()
  })

  test("deduplicates concurrent reads and revokes its object URL", async () => {
    let reads = 0
    const revoked: string[] = []
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = () => "blob:test-media"
    URL.revokeObjectURL = (url) => revoked.push(url)
    try {
      const api = {
        experimental: {
          media: {
            get: async () => {
              reads++
              return new Uint8Array([1, 2, 3])
            },
          },
        },
      }
      const live = createMediaCache(() => api as never)
      const [first, second] = await Promise.all([
        live.load(`media:${hash}`, "image/png"),
        live.load(`media:${hash}`, "image/png"),
      ])
      expect(first).toBe("blob:test-media")
      expect(second).toBe(first)
      expect(reads).toBe(1)
      expect(live.peek(`media:${hash}`)).toBe(first)
      live.dispose()
      expect(revoked).toEqual(["blob:test-media"])
    } finally {
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
    }
  })

  test("bounds decoded media by LRU entries and bytes", async () => {
    const revoked: string[] = []
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    let created = 0
    URL.createObjectURL = () => `blob:media-${++created}`
    URL.revokeObjectURL = (url) => revoked.push(url)
    try {
      const api = {
        experimental: { media: { get: async () => new Uint8Array([1, 2, 3]) } },
      }
      const live = createMediaCache(() => api as never, { maxEntries: 2, maxBytes: 6 })
      const first = `media:${"1".repeat(64)}`
      const second = `media:${"2".repeat(64)}`
      const third = `media:${"3".repeat(64)}`
      await live.load(first)
      await live.load(second)
      expect(live.peek(first)).toBe("blob:media-1")
      await live.load(third)
      expect(live.peek(first)).toBe("blob:media-1")
      expect(live.peek(second)).toBeUndefined()
      expect(live.peek(third)).toBe("blob:media-3")
      expect(revoked).toEqual(["blob:media-2"])
      live.dispose()
      expect(revoked).toEqual(["blob:media-2", "blob:media-1", "blob:media-3"])
    } finally {
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
    }
  })
})
