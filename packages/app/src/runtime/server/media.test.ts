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
})
