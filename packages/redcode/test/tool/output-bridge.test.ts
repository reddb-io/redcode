import { describe, test, expect } from "bun:test"
import { ConfigV1 } from "@reddb-io/redcode-core/v1/config/config"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { filesystem } from "@reddb-io/redcode-core/effect/app-node-platform"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { ToolOutputStore } from "@reddb-io/redcode-core/tool-output-store"
import { Effect, FileSystem } from "effect"
import { ToolOutputBridge } from "@/tool/output-bridge"
import { Config } from "@/config/config"
import { SessionID } from "@/session/schema"
import { Identifier } from "../../src/id/id"
import { Process } from "@/util/process"
import path from "path"
import { testEffect } from "../lib/effect"
import { writeFileStringScoped } from "../lib/filesystem"
import { TestConfig } from "../fixture/config"

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures")
const ROOT = path.resolve(import.meta.dir, "..", "..")

const nodes = [ToolOutputBridge.node, ToolOutputBridge.storeNode, FSUtil.node, filesystem] as const
const it = testEffect(LayerNode.compile(LayerNode.group(nodes)))

const configuredLayer = (cfg: ConfigV1.Info) =>
  LayerNode.compile(LayerNode.group([...nodes, Config.node]), [
    [Config.node, TestConfig.layer({ get: () => Effect.succeed(cfg) })],
  ])
const configuredIt = (cfg: ConfigV1.Info) => testEffect(configuredLayer(cfg))

const ctx = { sessionID: SessionID.make("ses_output_bridge"), callID: "call_output_bridge" }
const lines = (count: number) => Array.from({ length: count }, (_, i) => `line${i}`).join("\n")

describe("ToolOutputBridge", () => {
  describe("bound", () => {
    it.live("returns content unchanged when under limits", () =>
      Effect.gen(function* () {
        const svc = yield* ToolOutputBridge.Service
        const content = "line1\nline2\nline3"
        const result = yield* svc.bound(content, ctx)

        expect(result.truncated).toBe(false)
        expect(result.content).toBe(content)
        expect("outputPath" in result).toBe(false)
      }),
    )

    it.live("retains oversized output as a Managed Tool Output File in the shared directory", () =>
      Effect.gen(function* () {
        const svc = yield* ToolOutputBridge.Service
        const content = lines(ToolOutputBridge.MAX_LINES + 1000)
        const result = yield* svc.bound(content, ctx)

        expect(result.truncated).toBe(true)
        if (!result.truncated) throw new Error("expected truncated")
        expect(result.outputPath).toBeDefined()
        expect(path.dirname(result.outputPath!)).toBe(ToolOutputBridge.DIR)
        expect(path.dirname(result.outputPath!)).toBe(
          path.join(path.dirname(ToolOutputBridge.DIR), ToolOutputStore.MANAGED_DIRECTORY),
        )
        expect(path.basename(result.outputPath!)).toStartWith("tool_")
        expect(yield* (yield* FSUtil.Service).readFileString(result.outputPath!)).toBe(content)

        // The bounded text is the core store's: head and tail around one notice naming the file.
        expect(result.content).toContain(`... output truncated; full content saved to ${result.outputPath} ...`)
        expect(result.content).toStartWith("line0\n")
        expect(result.content).toEndWith(`line${ToolOutputBridge.MAX_LINES + 999}`)
        expect(result.content.split("\n").length).toBeLessThanOrEqual(ToolOutputBridge.MAX_LINES)
      }),
    )

    it.live("bounds a large single-line file by bytes", () =>
      Effect.gen(function* () {
        const svc = yield* ToolOutputBridge.Service
        const fsys = yield* FSUtil.Service
        const content = yield* fsys.readFileString(path.join(FIXTURES_DIR, "models-api.json"))
        expect(Buffer.byteLength(content, "utf-8")).toBeGreaterThan(ToolOutputBridge.MAX_BYTES)
        const result = yield* svc.bound(content, ctx)

        expect(result.truncated).toBe(true)
        expect(result.content).toContain("... output truncated; full content saved to ")
        expect(Buffer.byteLength(result.content, "utf-8")).toBeLessThanOrEqual(ToolOutputBridge.MAX_BYTES)
      }),
    )

    test("shares the core store's limits", () => {
      expect(ToolOutputBridge.MAX_LINES).toBe(ToolOutputStore.MAX_LINES)
      expect(ToolOutputBridge.MAX_BYTES).toBe(ToolOutputStore.MAX_BYTES)
    })

    it.live("limits() falls back to the core defaults when Config is not provided", () =>
      Effect.gen(function* () {
        const resolved = yield* (yield* ToolOutputBridge.Service).limits()
        expect(resolved.maxLines).toBe(ToolOutputStore.MAX_LINES)
        expect(resolved.maxBytes).toBe(ToolOutputStore.MAX_BYTES)
      }),
    )

    describe("with tool_output config", () => {
      const limitsIt = configuredIt({ tool_output: { max_lines: 123, max_bytes: 456 } })
      limitsIt.live("limits() reflects Redcode config overrides", () =>
        Effect.gen(function* () {
          const resolved = yield* (yield* ToolOutputBridge.Service).limits()
          expect(resolved.maxLines).toBe(123)
          expect(resolved.maxBytes).toBe(456)
        }),
      )

      // Huge byte budget isolates line bounding: 100 lines against max_lines: 10 proves the
      // configured line limit is what the core store enforces for legacy tools.
      const lineIt = configuredIt({ tool_output: { max_lines: 10, max_bytes: 1024 * 1024 } })
      lineIt.live("bound() applies the configured max_lines", () =>
        Effect.gen(function* () {
          const result = yield* (yield* ToolOutputBridge.Service).bound(lines(100), ctx)
          expect(result.truncated).toBe(true)
          expect(result.content).toContain("line0")
          expect(result.content).toContain("line99")
          expect(result.content).not.toContain("line50")
          expect(result.content.split("\n").length).toBeLessThanOrEqual(10)
        }),
      )

      // Huge line budget isolates byte bounding.
      const byteIt = configuredIt({ tool_output: { max_lines: 1_000_000, max_bytes: 100 } })
      byteIt.live("bound() applies the configured max_bytes", () =>
        Effect.gen(function* () {
          const result = yield* (yield* ToolOutputBridge.Service).bound("a".repeat(1000), ctx)
          expect(result.truncated).toBe(true)
          expect(Buffer.byteLength(result.content, "utf-8")).toBeLessThanOrEqual(100)
        }),
      )
    })

    it.live("keeps a lossy bounded output when the file cannot be retained", () =>
      Effect.gen(function* () {
        // A file where the directory should be is the cheapest unwritable store there is, and it
        // fails the same way a full disk does: the write is refused, the tool's own work is done.
        const svc = yield* ToolOutputBridge.Service
        const fs = yield* FileSystem.FileSystem
        yield* fs.remove(ToolOutputBridge.DIR, { recursive: true }).pipe(Effect.ignore)
        yield* fs.writeFileString(ToolOutputBridge.DIR, "not a directory")
        const result = yield* svc
          .bound(lines(ToolOutputBridge.MAX_LINES + 100), ctx)
          .pipe(Effect.ensuring(fs.remove(ToolOutputBridge.DIR, { force: true }).pipe(Effect.ignore)))

        expect(result.truncated).toBe(true)
        if (!result.truncated) throw new Error("expected truncated")
        expect(result.outputPath).toBeUndefined()
        expect(result.content).toStartWith("line0\n")
        expect(result.content).not.toContain("full content saved to")
        expect(result.content).toContain("could not be saved")
        expect(result.content.split("\n").length).toBeLessThanOrEqual(ToolOutputBridge.MAX_LINES)
      }),
    )
  })

  describe("retain", () => {
    it.live("writes one managed file for callers that stream into it", () =>
      Effect.gen(function* () {
        const file = yield* (yield* ToolOutputBridge.Service).retain("streamed")
        expect(path.dirname(file)).toBe(ToolOutputBridge.DIR)
        expect(yield* (yield* FSUtil.Service).readFileString(file)).toBe("streamed")
      }),
    )
  })

  test("loads the bridge in a fresh process", async () => {
    const out = await Process.run([process.execPath, "run", path.join(ROOT, "src", "tool", "output-bridge.ts")], {
      cwd: ROOT,
    })

    expect(out.code).toBe(0)
  }, 20000)

  describe("cleanup", () => {
    const DAY_MS = 24 * 60 * 60 * 1000

    it.live("expires managed files by mtime through the core store", () =>
      Effect.gen(function* () {
        const store = yield* ToolOutputStore.Service
        const fs = yield* FileSystem.FileSystem

        yield* fs.makeDirectory(ToolOutputBridge.DIR, { recursive: true })

        const old = path.join(ToolOutputBridge.DIR, Identifier.create("tool", "ascending", 2 ** 36 - 1))
        const recent = path.join(ToolOutputBridge.DIR, Identifier.create("tool", "ascending", 2 ** 36 + 1))

        yield* writeFileStringScoped(old, "old content")
        yield* writeFileStringScoped(recent, "recent content")
        yield* fs.utimes(old, new Date(), new Date(Date.now() - 10 * DAY_MS))
        yield* fs.utimes(recent, new Date(), new Date(Date.now() - 3 * DAY_MS))
        yield* store.cleanup()

        expect(yield* fs.exists(old)).toBe(false)
        expect(yield* fs.exists(recent)).toBe(true)
      }),
    )
  })
})
