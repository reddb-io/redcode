import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DesignAttachments } from "@/design/attachments"

// Ported from lavish-axi's attachment-store tests: the store is plain async code over a
// directory, so it is exercised with a temp root and real files.

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0, 0, 0, 13]),
  Buffer.from("IHDR", "ascii"),
  Buffer.from([0, 0, 0, 0x20, 0, 0, 0, 0x10]),
  Buffer.alloc(40),
])
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]),
  Buffer.from("JFIF\0", "ascii"),
  Buffer.alloc(9),
  Buffer.from([0xff, 0xc0, 0, 17, 8, 0, 0x30, 0, 0x40, 3]),
  Buffer.alloc(24),
])
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBPVP8 ", "ascii"),
  Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x50, 0x00, 0x30, 0x00]),
  Buffer.alloc(16),
])
const variant = (base: Buffer, n: number) => Buffer.concat([base, Buffer.from([n])])

let root = ""
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "redcode-attachments-"))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("what an image is", () => {
  test("is decided by the bytes: PNG, JPEG and WebP, nothing else", () => {
    expect(DesignAttachments.detectImageType(PNG)?.mime).toBe("image/png")
    expect(DesignAttachments.detectImageType(JPEG)?.mime).toBe("image/jpeg")
    expect(DesignAttachments.detectImageType(WEBP)?.mime).toBe("image/webp")
    expect(DesignAttachments.detectImageType(Buffer.from("<svg onload=alert(1)></svg>"))).toBeNull()
    expect(DesignAttachments.detectImageType(Buffer.from("GIF89a" + "x".repeat(20)))).toBeNull()
  })

  test("its dimensions come from the header of each format", () => {
    expect(DesignAttachments.imageDimensions(PNG, "image/png")).toEqual({ width: 32, height: 16 })
    expect(DesignAttachments.imageDimensions(JPEG, "image/jpeg")).toEqual({ width: 64, height: 48 })
    expect(DesignAttachments.imageDimensions(WEBP, "image/webp")).toEqual({ width: 80, height: 48 })
    expect(DesignAttachments.imageDimensions(Buffer.alloc(4), "image/png")).toBeNull()
  })
})

describe("writing", () => {
  test("stores content-addressed bytes, owner-only, with a sidecar, and returns what is on disk", async () => {
    const meta = await DesignAttachments.write(root, "proto_1", PNG)
    expect(meta.id).toMatch(/^[0-9a-f]{64}\.png$/)
    expect(meta.mime).toBe("image/png")
    expect(meta.bytes).toBe(PNG.length)
    expect(meta).toMatchObject({ width: 32, height: 16, type: "image" })
    expect(await readFile(meta.path)).toEqual(PNG)
    expect(JSON.parse(await readFile(meta.path + ".meta", "utf8"))).toMatchObject({ v: 1, width: 32, height: 16 })
    if (process.platform !== "win32") {
      expect((await stat(meta.path)).mode & 0o777).toBe(0o600)
      expect((await stat(path.dirname(meta.path))).mode & 0o777).toBe(0o700)
    }
    // No temp left behind.
    expect((await readdir(path.dirname(meta.path))).filter((f) => f.endsWith(".tmp"))).toEqual([])
  })

  test("identical content is one file and one id, and a re-upload restarts its clock", async () => {
    const first = await DesignAttachments.write(root, "proto_1", PNG)
    const old = new Date(Date.now() - 10 * 24 * 3600 * 1000)
    await utimes(first.path, old, old)
    const again = await DesignAttachments.write(root, "proto_1", PNG)
    expect(again.id).toBe(first.id)
    expect((await stat(first.path)).mtimeMs).toBeGreaterThan(old.getTime() + 1000)
    expect((await readdir(path.dirname(first.path))).filter((f) => f.endsWith(".png"))).toHaveLength(1)
  })

  test("refuses what it should, with the status the route answers", async () => {
    await expect(DesignAttachments.write(root, "proto_1", Buffer.alloc(0))).rejects.toMatchObject({ status: 400 })
    await expect(DesignAttachments.write(root, "proto_1", PNG, { maxBytes: 10 })).rejects.toMatchObject({ status: 413 })
    await expect(DesignAttachments.write(root, "proto_1", Buffer.from("not an image at all"))).rejects.toMatchObject({
      status: 415,
    })
    await expect(DesignAttachments.write(root, "../escape", PNG)).rejects.toMatchObject({ status: 400 })
  })

  test("refuses a new object that would push committed storage past the quota, and never evicts a fresh one", async () => {
    const cap = 4 * DesignAttachments.ALLOC_BLOCK_BYTES
    const first = await DesignAttachments.write(root, "proto_1", variant(PNG, 1), { maxDiskBytes: cap, ttlMs: null })
    // Two blocks (image + sidecar) are committed; a second image needs two more: exactly at the cap.
    await DesignAttachments.write(root, "proto_1", variant(PNG, 2), {
      maxDiskBytes: cap,
      ttlMs: null,
      evictionGraceMs: 3600_000,
    })
    // A third cannot fit, and both existing files are within the grace, so nothing is evicted.
    await expect(
      DesignAttachments.write(root, "proto_1", variant(PNG, 3), {
        maxDiskBytes: cap,
        ttlMs: null,
        evictionGraceMs: 3600_000,
      }),
    ).rejects.toMatchObject({ status: 507 })
    expect(await stat(first.path)).toBeTruthy()
    // Without the grace the oldest unreferenced one makes room.
    await DesignAttachments.write(root, "proto_1", variant(PNG, 3), {
      maxDiskBytes: cap,
      ttlMs: null,
      evictionGraceMs: 0,
    })
    expect((await DesignAttachments.list(root)).length).toBe(2)
  })
})

describe("resolving", () => {
  test("a client id becomes what is on disk, or nothing", async () => {
    const meta = await DesignAttachments.write(root, "proto_1", JPEG)
    const resolved = await DesignAttachments.resolve(root, "proto_1", meta.id)
    expect(resolved).toMatchObject({ id: meta.id, mime: "image/jpeg", bytes: JPEG.length, width: 64, height: 48 })
    expect(resolved!.path).toBe(meta.path)
    expect(await DesignAttachments.resolve(root, "proto_1", "0".repeat(64) + ".png")).toBeNull()
    expect(await DesignAttachments.resolve(root, "proto_2", meta.id)).toBeNull()
    expect(await DesignAttachments.resolve(root, "proto_1", "../../etc/passwd")).toBeNull()
    expect(await DesignAttachments.resolve(root, "proto_1", meta.id.replace(".jpg", ".svg"))).toBeNull()
  })

  test("a send's refs resolve all or nothing, naming the cap that was hit", async () => {
    const a = await DesignAttachments.write(root, "proto_1", variant(PNG, 1))
    const b = await DesignAttachments.write(root, "proto_1", variant(PNG, 2))
    const caps = { maxPerPrompt: 2, maxPromptBytes: 10_000 }
    const ok = await DesignAttachments.resolveAll(
      root,
      "proto_1",
      [{ attachments: [{ id: a.id, name: "a.png" }] }, {}],
      caps,
    )
    expect(ok.rejected).toEqual([])
    expect(ok.resolved[0]![0]).toMatchObject({ id: a.id, name: "a.png" })
    expect(ok.resolved[1]).toEqual([])

    const missing = await DesignAttachments.resolveAll(
      root,
      "proto_1",
      [{ attachments: [{ id: "0".repeat(64) + ".png" }] }],
      caps,
    )
    expect(missing.resolved).toEqual([])
    expect(missing.rejected[0]!.reason).toBe("not-found")

    const many = await DesignAttachments.resolveAll(
      root,
      "proto_1",
      [{ attachments: [{ id: a.id }, { id: b.id }, { id: a.id }] }],
      caps,
    )
    expect(many.rejected[0]!.reason).toBe("too-many")

    const heavy = await DesignAttachments.resolveAll(root, "proto_1", [{ attachments: [{ id: a.id }, { id: b.id }] }], {
      ...caps,
      maxPromptBytes: PNG.length + 1,
    })
    expect(heavy.rejected[0]!.reason).toBe("prompt-bytes-exceeded")

    const malformed = await DesignAttachments.resolveAll(root, "proto_1", [{ attachments: [{ id: 5 }] }], caps)
    expect(malformed.rejected[0]!.reason).toBe("malformed")
    const flood = await DesignAttachments.resolveAll(
      root,
      "proto_1",
      Array.from({ length: 300 }, () => ({ attachments: [{ id: a.id }] })),
      caps,
    )
    expect(flood.rejected[0]!.reason).toBe("too-many-in-request")
  })
})

describe("the sweep", () => {
  test("reaps what is both expired and unreferenced, keeps the rest, and prunes empty dirs", async () => {
    const old = new Date(Date.now() - 10 * 24 * 3600 * 1000)
    const expired = await DesignAttachments.write(root, "proto_1", variant(PNG, 1))
    const kept = await DesignAttachments.write(root, "proto_1", variant(PNG, 2))
    const fresh = await DesignAttachments.write(root, "proto_2", variant(PNG, 3))
    await utimes(expired.path, old, old)
    await utimes(kept.path, old, old)
    const result = await DesignAttachments.sweep(root, { referenced: new Set([`proto_1/${kept.id}`]) })
    expect(result.deleted).toBe(1)
    expect(await DesignAttachments.resolve(root, "proto_1", expired.id)).toBeNull()
    expect(await DesignAttachments.resolve(root, "proto_1", kept.id)).not.toBeNull()
    expect(await DesignAttachments.resolve(root, "proto_2", fresh.id)).not.toBeNull()
    // A disabled TTL reaps nothing.
    await utimes(fresh.path, old, old)
    expect((await DesignAttachments.sweep(root, { ttlMs: null })).deleted).toBe(0)
  })

  test("the quota evicts the oldest unreferenced files first, never a referenced one", async () => {
    const files = []
    for (let i = 1; i <= 4; i++) {
      const meta = await DesignAttachments.write(root, "proto_1", variant(PNG, i))
      const at = new Date(Date.now() - (10 - i) * 60_000)
      await utimes(meta.path, at, at)
      files.push(meta)
    }
    const perFile = 2 * DesignAttachments.ALLOC_BLOCK_BYTES
    await DesignAttachments.sweep(root, {
      ttlMs: null,
      maxDiskBytes: 2 * perFile,
      referenced: new Set([`proto_1/${files[0]!.id}`]),
    })
    const left = (await DesignAttachments.list(root)).map((f) => f.id).sort()
    // The referenced oldest stays; of the rest, the newest survives.
    expect(left).toEqual([files[0]!.id, files[3]!.id].sort())
  })

  test("reaps crash debris: a stale temp, and a sidecar whose image is gone", async () => {
    const meta = await DesignAttachments.write(root, "proto_1", PNG)
    const dir = path.dirname(meta.path)
    const stale = path.join(dir, `${meta.id}.123.4.tmp`)
    await writeFile(stale, "half")
    const old = new Date(Date.now() - 10 * 60_000)
    await utimes(stale, old, old)
    const live = path.join(dir, `${meta.id}.123.5.tmp`)
    await writeFile(live, "writing")
    const orphan = path.join(dir, "1".repeat(64) + ".png.meta")
    await writeFile(orphan, "{}")
    await DesignAttachments.sweep(root, { ttlMs: null })
    const names = await readdir(dir)
    expect(names).not.toContain(path.basename(stale))
    expect(names).toContain(path.basename(live))
    expect(names).not.toContain(path.basename(orphan))
    expect(names).toContain(meta.id + ".meta")
  })
})

describe("the limits", () => {
  test("come from config with sane fallbacks; only false or 0 disables a duration or the quota", () => {
    const defaults = DesignAttachments.resolveConfig()
    expect(defaults.maxBytes).toBe(10 * 1024 * 1024)
    expect(defaults.maxPerPrompt).toBe(4)
    expect(defaults.ttlMs).toBe(7 * 24 * 3600 * 1000)
    expect(defaults.maxDiskBytes).toBe(512 * 1024 * 1024)
    expect(defaults.maxObjects).toBe(Math.floor((512 * 1024 * 1024) / 8192))
    const custom = DesignAttachments.resolveConfig({
      max_bytes: 1000,
      max_per_prompt: 2,
      ttl_ms: false,
      max_disk_mb: 1,
    })
    expect(custom.maxBytes).toBe(1000)
    expect(custom.maxPerPrompt).toBe(2)
    expect(custom.ttlMs).toBeNull()
    expect(custom.maxDiskBytes).toBe(1024 * 1024)
    expect(DesignAttachments.resolveConfig({ max_disk_mb: false }).maxDiskBytes).toBeNull()
    // A value that floors below one is a typo, not a zero cap.
    expect(DesignAttachments.resolveConfig({ max_per_prompt: 0.5 as number }).maxPerPrompt).toBe(4)
  })
})
