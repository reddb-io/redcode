import { afterAll, describe, expect } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect, Layer } from "effect"
import { Design } from "@opencode/schema/design"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { DesignAppConnection } from "@opencode/core/design/app-connection"
import { DesignApp } from "@opencode/core/design/app"
import { DesignStore } from "@opencode/core/design/store"
import { FileAccess } from "@opencode/core/file-access"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { DesignLinkTool } from "@opencode/core/tool/plugin/design-link"
import { DesignPreviewTool } from "@opencode/core/tool/plugin/design-preview"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"
import { tempLocationLayer } from "./fixture/location"

const sessionID = Session.ID.make("ses_design_link")
const authorization = `Basic ${btoa("opencode:secret")}`
const ticketed = (origin: string) => `${origin}/design/session/${sessionID}/review?ticket=1.signed`

// Stands in for the owning Redcode server: it answers the link route only with its credential, and records calls.
const requests: string[] = []
const redcode = Bun.serve({
  port: 0,
  fetch: (request) => {
    const url = new URL(request.url)
    requests.push(url.pathname)
    if (request.headers.get("authorization") !== authorization) return new Response(null, { status: 401 })
    if (url.pathname !== `/design/session/${sessionID}/link`) return new Response(null, { status: 404 })
    return Response.json({ url: ticketed(url.origin), network: ticketed("http://192.168.1.20:4096") })
  },
})
afterAll(() => redcode.stop(true))

const served: { host?: DesignApp.Host } = {}
const assertions: Permission.AssertInput[] = []

// A published design whose prototype is one plain HTML file, so a publish reads no project tooling.
const root = mkdtempSync(path.join(tmpdir(), "design-review-link-"))
writeFileSync(path.join(root, "index.html"), "<main>Profile</main>")
afterAll(() => rmSync(root, { recursive: true, force: true }))
const designID = Design.ID.make("design_profile")
const document: Design.Info = {
  id: designID,
  sessionID,
  name: "Profile",
  journey: "new",
  engine: "html",
  kind: "screen",
  target: "web",
  root,
  application: root,
  entry: "index.html",
  brief: { objective: "Profile", audience: "Account owners", content: "", constraints: "", references: [] },
  designSystem: {},
  decisions: [],
  questions: [],
  scenarios: [],
  sources: [],
  tweaks: {},
  revision: null,
  approvedRevision: null,
  ended: false,
  updated: 1,
}
const revision: Design.Revision = {
  id: "rev_profile",
  designID,
  parent: null,
  name: "Profile",
  created: 1,
  files: { "index.html": "hash" },
  document,
}

const linkNode = makeLocationNode({
  name: "test/design-review-link-plugins",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      yield* registerToolPlugin(DesignLinkTool.Plugin)
      yield* registerToolPlugin(DesignPreviewTool.Plugin)
    }),
  ),
  deps: [Tool.node, Permission.node, DesignAppConnection.node, DesignStore.node, FileAccess.node, Location.node],
})

const tools = testEffect(
  AppNodeBuilder.build(LayerNode.group([Tool.node, linkNode]), [
    Location.node.replace(tempLocationLayer),
    Permission.node.replace(permissionLayer({ assert: (input) => Effect.sync(() => assertions.push(input)) })),
    DesignStore.node.replace(
      Layer.mock(DesignStore.Service, {
        storage: path.join(root, "store"),
        blobs: path.join(root, "blobs"),
        configured: () => Effect.succeed(undefined),
        get: () => Effect.succeed(document),
        publish: () => Effect.succeed(revision),
        revisions: () => Effect.succeed([revision]),
      }),
    ),
    FileAccess.node.replace(Layer.mock(FileAccess.Service, {})),
    DesignAppConnection.node.replace(
      Layer.mock(DesignAppConnection.Service, {
        host: () => served.host,
        connect: () => Promise.reject(new Error("unused design app")),
      }),
    ),
  ]),
)

const call = (input: unknown, name: string = DesignLinkTool.name) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id: `call_${name}`, name, input },
})

const reset = (host?: DesignApp.Host) =>
  Effect.sync(() => {
    served.host = host
    requests.length = 0
    assertions.length = 0
  })

describe("design_link", () => {
  tools.effect("returns the stable local review link without a ticket, a publish or a server request", () =>
    Effect.gen(function* () {
      yield* reset({ url: redcode.url.origin, authorization })
      const result = yield* executeTool(yield* Tool.Service, call({}))

      if (result.status !== "completed") console.log("DEBUG", JSON.stringify(result))
      expect(result.status).toBe("completed")
      expect(result.output).toContain(`Review: ${redcode.url.origin}/design/session/${sessionID}/review\n`)
      expect(result.output).not.toContain("ticket=")
      expect(result.output).toContain(`redcode design ${sessionID}`)
      expect(requests).toEqual([])
      expect(assertions.map((item) => [item.action, item.sessionID])).toEqual([["design_link", sessionID]])
    }),
  )

  tools.effect("adds fresh ticketed share links from the owning server only when sharing is asked for", () =>
    Effect.gen(function* () {
      yield* reset({ url: redcode.url.origin, authorization })
      const result = yield* executeTool(yield* Tool.Service, call({ share: true }))

      if (result.status !== "completed") console.log("DEBUG", JSON.stringify(result))
      expect(result.status).toBe("completed")
      expect(result.output).toContain(`Review: ${redcode.url.origin}/design/session/${sessionID}/review\n`)
      expect(result.output).toContain(`Share on the local network: ${ticketed("http://192.168.1.20:4096")}`)
      expect(result.output).toContain(`unpaired browser on this machine: ${ticketed(redcode.url.origin)}`)
      expect(result.output).toContain("within 10 minutes")
      expect(requests).toEqual([`/design/session/${sessionID}/link`])
    }),
  )

  tools.effect("says where the review is when no server serves this Session, without inventing a link", () =>
    Effect.gen(function* () {
      yield* reset()
      const result = yield* executeTool(yield* Tool.Service, call({}))

      expect(result.status).toBe("error")
      expect(JSON.stringify(result)).toContain("Design panel")
      expect(requests).toEqual([])
    }),
  )
})

describe("design_preview", () => {
  tools.effect(
    "names the stable review link, never a ticket, so the transcript keeps a link that does not expire",
    () =>
      Effect.gen(function* () {
        yield* reset({ url: redcode.url.origin, authorization })
        const result = yield* executeTool(
          yield* Tool.Service,
          call({ id: designID, name: "Profile" }, DesignPreviewTool.name),
        )
        const text = JSON.stringify(result.content)

        expect(result.status).toBe("completed")
        expect(text).toContain(`Review: ${redcode.url.origin}/design/session/${sessionID}/review`)
        expect(text).not.toContain("ticket=")
        expect(requests).toEqual([])
      }),
  )
})
