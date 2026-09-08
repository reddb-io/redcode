import { DesignFeedback } from "../../src/design/feedback"
import { SessionStatus } from "../../src/session/status"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { SessionEvent } from "@reddb-io/redcode-core/session/event"
import { DesignLegacy } from "../../src/design/legacy"
import { TestInstance } from "../fixture/fixture"
import { ToolRegistry } from "../../src/tool/registry"
import { MessageID } from "../../src/session/schema"
import type { Tool } from "../../src/tool/tool"
import { SessionProjector } from "@reddb-io/redcode-core/session/projector"
import { expect } from "bun:test"
import { Effect, DateTime } from "effect"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { DesignStore } from "@reddb-io/redcode-core/design/store"
import { AppNodeBuilderV1 } from "../../src/effect/app-node-builder-v1"
import { DesignStudio } from "../../src/design/studio"
import { Session } from "../../src/session/session"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilderV1.build(
    LayerNode.group([
      DesignStudio.node,
      DesignFeedback.node,
      SessionStatus.node,
      EventV2Bridge.node,
      Agent.node,
      Session.node,
      SessionProjector.node,
      ToolRegistry.node,
      Permission.node,
    ]),
  ),
)

it.instance("Design remains a cyan primary mode and edits only prototype work", () =>
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const design = yield* agents.get("design")
    expect(design?.mode).toBe("primary")
    expect(design?.color).toBe("info")
    expect(design?.hidden).not.toBe(true)
    expect(Permission.evaluate("bash", "*", design!.permission).action).toBe("deny")
    expect(Permission.evaluate("edit", "src/product.ts", design!.permission).action).toBe("deny")
    expect(Permission.evaluate("design_document", "*", design!.permission).action).toBe("allow")
  }),
)

it.instance("the existing TUI session owns new revisions and SVG assets without a second session", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const studio = yield* DesignStudio.Service
    const session = yield* sessions.create({ agent: "design" })
    yield* studio.assertSession(session.id)
    yield* studio.use(
      Effect.gen(function* () {
        const store = yield* DesignStore.Service
        const document = yield* store.create(session.id, {
          name: "Settings",
          engine: "html",
          journey: "new",
          kind: "screen",
        })
        expect(document.sessionID).toBe(session.id)
        const agents = yield* Agent.Service
        const design = yield* agents.get("design")
        expect(Permission.evaluate("edit", document.root + "/index.html", design!.permission).action).toBe("allow")
        yield* Effect.promise(() =>
          Bun.write(document.root + "/index.html", "<!doctype html><html><body><button>Save</button></body></html>"),
        )
        const revision = yield* store.publish(document.id, "First direction")
        const asset = yield* store.importAsset(document.id, {
          name: "mark.svg",
          mime: "image/svg+xml",
          data: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="4"/></svg>',
          ).toString("base64"),
          source: "user",
        })
        expect(asset.mime).toBe("image/svg+xml")
        expect((yield* store.list(session.id)).map((item) => item.id)).toEqual([document.id])
        expect((yield* store.revisions(document.id))[0].id).toBe(revision.id)
        expect((yield* sessions.get(session.id)).agent).toBe("design")
      }),
    )
  }),
)

it.instance("the TUI model receives and executes the new Design toolset", () =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const permissions = yield* Permission.Service
    const session = yield* sessions.create({ agent: "design" })
    const agent = yield* agents.get("design")
    const tools = yield* registry.all()
    expect(tools.map((tool) => tool.id)).toEqual(
      expect.arrayContaining([
        "design_document",
        "design_preview",
        "design_asset",
        "design_media",
        "design_generate",
        "design_export",
        "design_jobs",
        "design_exit",
      ]),
    )
    const context: Tool.Context = {
      sessionID: session.id,
      messageID: MessageID.ascending(),
      agent: "design",
      abort: new AbortController().signal,
      messages: [],
      metadata: () => Effect.void,
      ask: (request) =>
        permissions.ask({ ...request, sessionID: session.id, ruleset: agent!.permission }).pipe(Effect.orDie),
    }
    const document = yield* tools
      .find((tool) => tool.id === "design_document")!
      .execute(
        { action: "create", input: { name: "TUI tooling", engine: "html", journey: "new", kind: "screen" } },
        context,
      )
    expect(document.output).toContain("Root:")
    expect(document.output).toContain("TUI tooling")
    const root = document.output
      .split("\n")
      .find((line) => line.startsWith("Root: "))!
      .slice(6)
    const written = yield* tools
      .find((tool) => tool.id === "write")!
      .execute(
        { filePath: root + "/index.html", content: "<!doctype html><html><body>TUI write verified</body></html>" },
        context,
      )
    expect(written.output).not.toContain("denied")
    expect(yield* Effect.promise(() => Bun.file(root + "/index.html").text())).toContain("TUI write verified")
    const list = yield* tools.find((tool) => tool.id === "design_document")!.execute({ action: "list" }, context)
    expect(list.output).toContain("TUI tooling")
    const directory = (yield* TestInstance).directory
    const legacy = directory + "/.red/code/designs/previous"
    yield* Effect.promise(async () => {
      const { mkdir } = await import("node:fs/promises")
      await mkdir(legacy + "/.review", { recursive: true })
      await Bun.write(
        legacy + "/index.html",
        '<!doctype html><link rel="stylesheet" href="../../vendor/daisyui.css"><h1>Original prototype</h1>',
      )
      await Bun.write(legacy + "/.review/private.txt", "Private review notes")
      await Bun.write(
        legacy + "/design.json",
        JSON.stringify({ version: 1, decisions: ["Use a compact header"], questions: ["Which empty state?"] }),
      )
    })
    const studio = yield* DesignStudio.Service
    const imported = yield* studio.use(DesignLegacy.importPrototype({ path: legacy }, context))
    expect(imported.root).not.toBe(legacy)
    expect(imported.decisions.map((item) => item.text)).toContain("Use a compact header")
    expect(imported.questions).toContain("Which empty state?")
    expect(yield* Effect.promise(() => Bun.file(legacy + "/index.html").text())).toContain("../../vendor/daisyui.css")
    expect(yield* Effect.promise(() => Bun.file(imported.root + "/index.html").text())).toContain(
      'href="vendor/daisyui.css"',
    )
    expect(yield* Effect.promise(() => Bun.file(imported.root + "/.review/private.txt").exists())).toBe(false)
    expect(yield* Effect.promise(() => Bun.file(legacy + "/.review/private.txt").text())).toBe("Private review notes")
  }),
)

it.instance("queued browser feedback does not restart an interrupted TUI session", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const studio = yield* DesignStudio.Service
    const feedback = yield* DesignFeedback.Service
    const status = yield* SessionStatus.Service
    const events = yield* EventV2Bridge.Service
    const session = yield* sessions.create({ agent: "design" })
    const document = yield* studio.use(
      Effect.gen(function* () {
        const store = yield* DesignStore.Service
        const document = yield* store.create(session.id, {
          name: "Queue",
          journey: "new",
          engine: "html",
          kind: "screen",
        })
        const revision = yield* store.publish(document.id, "Queue review")
        return { id: document.id, revision: revision.id }
      }),
    )
    yield* status.set(session.id, { type: "busy" })
    const receipt = yield* feedback.admit(session.id, document.id, {
      id: "msg_queued_interrupt",
      revision: document.revision,
      text: "Wait for the current work",
      items: [],
      assets: [],
      snapshot: "",
      end: false,
      delivery: "queue",
    })
    expect(receipt.status).toBe("pending")
    yield* events.publish(SessionEvent.Turn.Ended, {
      sessionID: session.id,
      timestamp: yield* DateTime.now,
      finished: false,
    })
    yield* status.set(session.id, { type: "idle" })
    yield* Effect.sleep("300 millis")
    expect(yield* sessions.messages({ sessionID: session.id })).toHaveLength(0)
    expect(yield* status.get(session.id)).toEqual({ type: "idle" })
  }),
)
