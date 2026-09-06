import { describe, expect } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { Truncate } from "@/tool/truncate"
import { Agent } from "@/agent/agent"
import { DesignRegistry } from "@/design/registry"
import { DesignPreviewTool } from "@/tool/design-preview"
import { DesignManifest } from "@/design/manifest"
import { testEffect } from "../lib/effect"

process.env["REDCODE_DESIGN_NO_OPEN"] = "1"

const it = testEffect(LayerNode.compile(LayerNode.group([DesignRegistry.node, FSUtil.node, Truncate.node, Agent.node])))

const ctx = {
  sessionID: "ses_test",
  messageID: "msg_test",
  callID: "call_test",
  agent: "design",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
  extra: {},
} as never

describe("design_preview, judging what it opens", () => {
  it.instance("names the missing states and writes them into design.json as questions", () =>
    Effect.gen(function* () {
      const instance = yield* InstanceState.context
      const fs = yield* FSUtil.Service
      const root = path.join(instance.directory, "proto")
      yield* fs.ensureDir(root)
      yield* Effect.promise(() => Bun.write(path.join(root, "index.html"), `<main data-state="populated">hi</main>`))
      yield* Effect.promise(() =>
        Bun.write(
          DesignManifest.file(root),
          DesignManifest.serialize({ ...DesignManifest.empty("proto"), questions: ["what about mobile?"] }),
        ),
      )

      const tool = yield* (yield* DesignPreviewTool).init()
      const result = yield* tool.execute({ path: "proto" }, ctx)
      expect(result.output).toContain("States missing: loading, empty, error, edge")
      expect(result.metadata.missingStates).toEqual(["loading", "empty", "error", "edge"])

      const manifest = DesignManifest.parse(
        yield* Effect.promise(() => Bun.file(DesignManifest.file(root)).text()),
        "x",
      )
      expect(manifest.questions[0]).toBe("what about mobile?")
      expect(manifest.questions.filter((q) => q.startsWith("state:")).length).toBe(4)

      // The next revision answers one of them, and the question goes away.
      yield* Effect.promise(() =>
        Bun.write(path.join(root, "index.html"), `<main data-state="populated"><p data-state="error">x</p></main>`),
      )
      yield* tool.execute({ path: "proto" }, ctx)
      const again = DesignManifest.parse(yield* Effect.promise(() => Bun.file(DesignManifest.file(root)).text()), "x")
      expect(again.questions.some((q) => q.startsWith("state:error"))).toBe(false)
      expect(again.questions.filter((q) => q.startsWith("state:")).length).toBe(3)
    }),
  )

  it.instance("checks a deck as a deck", () =>
    Effect.gen(function* () {
      const instance = yield* InstanceState.context
      const fs = yield* FSUtil.Service
      const root = path.join(instance.directory, "deck")
      yield* fs.ensureDir(root)
      yield* Effect.promise(() => Bun.write(path.join(root, "index.html"), `<section class="slide">1</section>`))
      yield* Effect.promise(() =>
        Bun.write(
          DesignManifest.file(root),
          DesignManifest.serialize({ ...DesignManifest.empty("deck"), kind: "deck" }),
        ),
      )
      const tool = yield* (yield* DesignPreviewTool).init()
      const result = yield* tool.execute({ path: "deck" }, ctx)
      expect(result.output).toContain("(deck)")
      expect(result.metadata.findings).toContain("slide-theme-missing")
    }),
  )
})

describe("design_preview, after the person ended the review", () => {
  it.instance("does not reopen it on its own, and does when the agent relays the ask", () =>
    Effect.gen(function* () {
      const instance = yield* InstanceState.context
      const fs = yield* FSUtil.Service
      const root = path.join(instance.directory, "closed")
      yield* fs.ensureDir(root)
      yield* Effect.promise(() => Bun.write(path.join(root, "index.html"), `<main data-state="populated">hi</main>`))
      const tool = yield* (yield* DesignPreviewTool).init()
      const first = yield* tool.execute({ path: "closed" }, ctx)
      expect(first.metadata.status).toBe("open")

      const registry = yield* DesignRegistry.Service
      yield* registry.end(first.metadata.id, "user")

      const refused = yield* tool.execute({ path: "closed" }, ctx)
      expect(refused.metadata.status).toBe("user-ended")
      expect(refused.output).toContain("The user ended the review")
      expect((yield* registry.get(first.metadata.id))!.revision).toBe(first.metadata.revision)

      const again = yield* tool.execute({ path: "closed", reopen: true }, ctx)
      expect(again.metadata.status).toBe("open")
      expect(again.metadata.revision).toBe(first.metadata.revision + 1)
      expect((yield* registry.get(first.metadata.id))!.ended).toBeUndefined()
    }),
  )
})
