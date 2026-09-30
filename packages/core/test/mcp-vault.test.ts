import { describe, expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Image } from "@opencode/core/image"
import { Mcp } from "@opencode/core/mcp/index"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { McpTool } from "@opencode/core/tool/mcp"
import { Vault } from "@opencode/core/vault/vault"
import { Project } from "@opencode/schema/project"
import { testEffect } from "./lib/effect"
import { imagePassthrough } from "./lib/image"
import { permissionLayer } from "./lib/permission"
import { executeTool, toolIdentity } from "./lib/tool"

// Every fixture is assembled from parts so no secret scanner mistakes it for a real credential.
const token = "ghp" + "_" + "p".repeat(36)
const jwt = ["eyJ" + "hbGciOiJIUzI1NiJ9", "eyJ" + "zdWIiOiJtY3AifQ", "c2lnbmF0dXJl" + "LW1jcA"].join(".")
const projectID = Project.ID.make("prj_mcp_vault")
const sessionID = Session.ID.make("ses_mcp_vault")

const invocations: Array<Parameters<Mcp.Interface["callTool"]>[0]> = []
const asked: Permission.AssertInput[] = []
let decline: string | undefined

const mcp = Layer.mock(Mcp.Service, {
  tools: () =>
    Effect.succeed([
      {
        server: Mcp.ServerName.make("demo"),
        name: "call",
        codemode: false,
        description: "Echoes the arguments it received",
        inputSchema: { type: "object", properties: {} },
      } satisfies Mcp.Tool,
      {
        server: Mcp.ServerName.make("demo"),
        name: "login",
        codemode: false,
        description: "Returns a session token",
        inputSchema: { type: "object", properties: {} },
      } satisfies Mcp.Tool,
    ]),
  callTool: (input) =>
    Effect.sync(() => {
      invocations.push(input)
      if (input.name === "login")
        return {
          server: Mcp.ServerName.make(input.server),
          tool: input.name,
          isError: false,
          structured: { session: { token: jwt } },
          content: [{ type: "text", text: `token=${jwt}` }],
        } satisfies Mcp.ToolResult
      return {
        server: Mcp.ServerName.make(input.server),
        tool: input.name,
        isError: false,
        content: [{ type: "text", text: `received ${JSON.stringify(input.args)}` }],
      } satisfies Mcp.ToolResult
    }),
})

const permissions = permissionLayer({
  assert: (input) => Effect.sync(() => void asked.push(input)),
  decide: (input) =>
    Effect.sync(() => asked.push(input)).pipe(
      Effect.andThen(
        decline === undefined
          ? Effect.succeed("once" as const)
          : Effect.fail(new Permission.CorrectedError({ feedback: decline })),
      ),
    ),
})

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Tool.node, McpTool.node]), [
    Mcp.node.replace(mcp),
    Permission.node.replace(permissions),
    Bus.node.replace(Layer.mock(Bus.Service, { subscribe: () => Stream.never })),
    Image.node.replace(imagePassthrough),
  ]),
)

const reset = () => {
  invocations.length = 0
  asked.length = 0
  decline = undefined
}

const bound = () => {
  const vault = Vault.make()
  Effect.runSync(vault.set({ projectID, name: "api-key", value: token, origin: "user" }))
  return Vault.bind(vault, projectID)
}

const call = (name: string, input: Record<string, unknown>, id: string) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name, input },
})

const run = (name: string, input: Record<string, unknown>, id: string, binding: Vault.Binding) =>
  Effect.gen(function* () {
    const registry = yield* Tool.Service
    const registration = yield* McpTool.Service
    yield* registration.flush
    return yield* executeTool(registry, call(name, input, id)).pipe(Effect.provideService(Vault.Current, binding))
  })

describe("MCP vault references", () => {
  it.effect("resolves references only in the arguments sent to the server, after asking for that server", () =>
    Effect.gen(function* () {
      reset()
      const input = { headers: { Authorization: "Bearer {vault:api-key}" }, keys: ["{vault:api-key}"] }
      const settled = yield* run("demo_call", input, "call-mcp-vault", bound())
      expect(invocations.map((item) => item.args)).toEqual([
        { headers: { Authorization: `Bearer ${token}` }, keys: [token] },
      ])
      expect(asked.find((item) => item.action === "vault")).toMatchObject({
        resources: ["api-key@mcp:demo"],
        force: true,
        metadata: { secrets: ["api-key"], destinations: ["mcp:demo"], command: "demo_call" },
      })
      // The server echoed the value, which comes back as its reference.
      expect(JSON.stringify(settled)).toContain("{vault:api-key}")
      expect(JSON.stringify([asked, settled])).not.toContain(token)
    }),
  )

  it.effect("fails an unknown reference without calling the server", () =>
    Effect.gen(function* () {
      reset()
      const settled = yield* run("demo_call", { key: "{vault:api-key-9}" }, "call-mcp-unknown", bound())
      expect(settled).toEqual({
        status: "error",
        error: { type: "tool.execution", message: Vault.unknownReference("api-key-9") },
      })
      expect(invocations).toEqual([])
    }),
  )

  it.effect("tells the model what the user said when they decline the server, and calls nothing", () =>
    Effect.gen(function* () {
      reset()
      decline = "use the staging key instead"
      const settled = yield* run("demo_call", { key: "{vault:api-key}" }, "call-mcp-declined", bound())
      expect(settled).toEqual({
        status: "error",
        error: { type: "tool.execution", message: "The user declined: use the staging key instead" },
      })
      expect(invocations).toEqual([])
    }),
  )

  it.effect("stores a token the server returns, in text and structured output, bound to that server", () =>
    Effect.gen(function* () {
      reset()
      const binding = bound()
      const settled = yield* run("demo_login", {}, "call-mcp-login", binding)
      expect(settled).toMatchObject({
        status: "completed",
        output: { session: { token: "{vault:jwt-1}" } },
        content: [
          { type: "text", text: "token={vault:jwt-1}" },
          {
            type: "text",
            text: "Stored 1 secret from the output as {vault:jwt-1}; use that reference in later commands.",
          },
        ],
      })
      expect(yield* binding.resolve("jwt-1")).toBe(jwt)
      expect(yield* binding.hosts(["jwt-1"])).toEqual(new Map([["jwt-1", ["mcp:demo"]]]))
      // No reference went to the server, so nothing but the tool itself was asked.
      expect(asked.map((item) => item.action)).toEqual(["demo_login"])
      expect(JSON.stringify(settled)).not.toContain(jwt)
    }),
  )
})
