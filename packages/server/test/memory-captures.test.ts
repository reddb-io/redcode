import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createMemoryCaptures, type MemoryCaptures } from "../src/memory-captures"

const roots: string[] = []
const services: MemoryCaptures[] = []

afterEach(async () => {
  services.splice(0).forEach((service) => service.close())
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "redcode-memory-captures-"))
  roots.push(root)
  const service = await createMemoryCaptures(root)
  services.push(service)
  return service
}

async function settled(service: MemoryCaptures, id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const capture = (await service.list()).find((item) => item.id === id)
    if (capture && !["pending", "running"].includes(capture.state)) return capture
    await Bun.sleep(25)
  }
  throw new Error("capture did not settle")
}

describe("memory diagnostic captures", () => {
  test("persists a bounded process sample bundle and removes it", async () => {
    const service = await setup()
    const started = await service.start({
      kind: "samples",
      target: { kind: "server" },
      durationMs: 1_000,
      retentionMs: 60_000,
    })
    const completed = await settled(service, started.id)

    expect(completed.state).toBe("completed")
    expect(completed.size).toBeGreaterThan(0)
    const download = service.download(started.id)
    const bundle = JSON.parse(await readFile(download.file, "utf8"))
    expect(bundle).toMatchObject({ format: "redcode.process-samples.v1", target: { kind: "server" }, logs: [] })
    expect(bundle.samples.length).toBeGreaterThan(0)

    await service.delete(started.id)
    expect(await service.list()).toEqual([])
  })

  test("cancels a running capture without leaving an artifact", async () => {
    const service = await setup()
    const started = await service.start({
      kind: "samples",
      target: { kind: "server" },
      durationMs: 60_000,
      retentionMs: 60_000,
    })

    await service.cancel(started.id)
    const cancelled = await settled(service, started.id)
    expect(cancelled.state).toBe("cancelled")
    expect(() => service.download(started.id)).toThrow("Completed diagnostic capture was not found")
  })

  test("recovers interrupted manifests and ignores malformed local metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "redcode-memory-captures-"))
    roots.push(root)
    const directory = path.join(root, "diagnostics", "memory")
    await mkdir(directory, { recursive: true })
    const id = "cap_11111111-1111-4111-8111-111111111111"
    await writeFile(
      path.join(directory, `${id}.meta.json`),
      JSON.stringify({
        id,
        kind: "cpu",
        target: { kind: "server" },
        state: "running",
        createdAt: Date.now(),
        startedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }),
    )
    await writeFile(path.join(directory, "broken.meta.json"), "{")
    const service = await createMemoryCaptures(root)
    services.push(service)

    expect(await service.list()).toEqual([
      expect.objectContaining({ id, state: "failed", error: "The server restarted before this capture completed." }),
    ])
  })

  test("rejects an artifact reference outside the local diagnostics directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "redcode-memory-captures-"))
    roots.push(root)
    const directory = path.join(root, "diagnostics", "memory")
    await mkdir(directory, { recursive: true })
    const id = "cap_22222222-2222-4222-8222-222222222222"
    await writeFile(
      path.join(directory, `${id}.meta.json`),
      JSON.stringify({
        id,
        kind: "samples",
        target: { kind: "server" },
        state: "completed",
        createdAt: Date.now(),
        completedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        filename: "../outside.json",
        size: 10,
      }),
    )
    const service = await createMemoryCaptures(root)
    services.push(service)

    expect(await service.list()).toEqual([
      expect.objectContaining({
        id,
        state: "failed",
        filename: undefined,
        size: undefined,
        error: "The stored diagnostic artifact reference is invalid.",
      }),
    ])
    expect(() => service.download(id as never)).toThrow("Completed diagnostic capture was not found")
  })
})
