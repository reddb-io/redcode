import { describe, expect } from "bun:test"
import { Message } from "@opencode/ai"
import { OpenAIChat } from "@opencode/ai/protocols"
import { Agent } from "@opencode/schema/agent"
import { Money } from "@opencode/schema/money"
import { Session } from "@opencode/schema/session"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionModelRequest } from "@opencode/core/session/model-request"
import { SessionModelTransport } from "@opencode/core/session/model-transport"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { Tool } from "@opencode/core/tool"
import { Vault } from "@opencode/core/vault/vault"
import { DateTime, Effect } from "effect"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)

// Assembled from parts so no secret scanner mistakes it for a real credential.
const token = "ghp" + "_" + "c".repeat(36)
const jwt = ["eyJ" + "hbGciOiJIUzI1NiJ9", "eyJ" + "zdWIiOiIxMjM0NTY3ODkwIn0", "c2lnbmF0dXJl" + "LXBhcnQ"].join(".")
const otherProject = Project.ID.make("prj_vault_request_other")
const agent = Agent.ID.make("build")
const session = Session.Info.make({
  id: Session.ID.make("ses_vault_request"),
  projectID: Project.ID.global,
  cost: Money.USD.zero,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
  location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
})
const model = SessionRunnerModel.resolved(OpenAIChat.route.model({ id: "gpt-5.5", provider: "test" }), {
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  cost: [],
  limit: { context: 200_000, output: 32_000 },
})
const transport = SessionModelTransport.Service.of({
  bind: () => ({ execute: () => Effect.die("unused WebSocket execution") }),
  close: () => Effect.void,
  closeAll: Effect.void,
})
const call = (id: string) => ({
  sessionID: session.id,
  agent,
  messageID: SessionMessage.ID.create(),
  call: { type: "tool-call" as const, id, name: "probe", input: { command: "{vault:github-token-1}" } },
})

const prepare = (execute: Tool.Snapshot["execute"], messages: Message[] = []) =>
  SessionModelRequest.Service.pipe(
    Effect.provide(SessionModelRequest.layer),
    Effect.flatMap((requests) =>
      requests.primary({ session, agent, model, system: [], messages, tools: { definitions: [], execute } }),
    ),
  )

describe("SessionModelRequest vault seam", () => {
  it.effect("resolves references for the Session's project and scrubs the value from what the tool returns", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const name = yield* vault.put({ projectID: session.projectID, kind: "github-token", value: token })
      const prepared = yield* prepare(() =>
        Effect.gen(function* () {
          const resolved = yield* Vault.resolveAll([name])
          const value = "values" in resolved ? (resolved.values.get(name) ?? "") : ""
          return {
            output: { echoed: value },
            content: [{ type: "text" as const, text: `server said ${value}` }],
            metadata: { preview: [value] },
          }
        }),
      )
      const result = yield* prepared.executeTool(call("call_vault_result"))
      expect(result.content).toEqual([{ type: "text", text: `server said {vault:${name}}` }])
      expect(result.output).toEqual({ echoed: `{vault:${name}}` })
      expect(result.metadata).toEqual({ preview: [`{vault:${name}}`] })
      expect(JSON.stringify(result)).not.toContain(token)
    }).pipe(Effect.provideService(SessionModelTransport.Service, transport)),
  )

  it.effect("scrubs the value from a failure the model will read", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const name = yield* vault.put({ projectID: session.projectID, kind: "github-token", value: token })
      const prepared = yield* prepare(() => Effect.fail(new Tool.Error({ message: `401 for token ${token}` })))
      const error = yield* prepared.executeTool(call("call_vault_error")).pipe(Effect.flip)
      expect(error.message).toBe(`401 for token {vault:${name}}`)
    }).pipe(Effect.provideService(SessionModelTransport.Service, transport)),
  )

  it.effect("sends a placeholder for a message the user withheld, by its ID, and leaves the rest", () =>
    Effect.gen(function* () {
      const withheld = SessionMessage.ID.create()
      const requests = yield* SessionModelRequest.Service.pipe(Effect.provide(SessionModelRequest.layer))
      const prepared = yield* requests.primary({
        session: Session.Info.make({ ...session, metadata: { restricted: { [withheld]: "withheld" } } }),
        agent,
        model,
        system: [],
        messages: [
          Message.make({ id: withheld, role: "user", content: "a senha é " + "banana" + "123" }),
          Message.assistant("noted"),
          Message.user("next request"),
        ],
        tools: { definitions: [], execute: () => Effect.die("unused tool") },
      })
      const sent = JSON.stringify(prepared.request.messages)
      expect(sent).not.toContain("banana")
      expect(sent).toContain("[message withheld: restricted content]")
      expect(sent).toContain("next request")
    }).pipe(Effect.provideService(SessionModelTransport.Service, transport)),
  )

  it.effect("replaces a vaulted value in user text rebuilt for the provider", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const name = yield* vault.put({ projectID: session.projectID, kind: "github-token", value: token })
      const prepared = yield* prepare(
        () => Effect.die("unused tool"),
        [Message.user(`earlier I pasted ${token}`), Message.assistant("noted")],
      )
      expect(JSON.stringify(prepared.request.messages)).not.toContain(token)
      expect(JSON.stringify(prepared.request.messages)).toContain(`{vault:${name}}`)
    }).pipe(Effect.provideService(SessionModelTransport.Service, transport)),
  )

  it.effect("scrubs a value the tool captured during the call from its own result", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const login = JSON.stringify({ token: jwt })
      const prepared = yield* prepare(() =>
        Effect.gen(function* () {
          const binding = yield* Vault.Current
          const captured = binding ? yield* binding.capture([login], ["api.example.com"]) : undefined
          return {
            output: { body: login },
            content: [{ type: "text" as const, text: `${login}\n\n${Vault.captureNote(captured?.names ?? [])}` }],
          }
        }),
      )
      const result = yield* prepared.executeTool(call("call_vault_capture"))
      const [entry] = yield* vault.list(session.projectID)
      expect(entry).toMatchObject({ name: "jwt-1", kind: "jwt", hosts: ["api.example.com"] })
      expect(result.content).toEqual([
        {
          type: "text",
          text: '{"token":"{vault:jwt-1}"}\n\nStored 1 secret from the output as {vault:jwt-1}; use that reference in later commands.',
        },
      ])
      expect(result.output).toEqual({ body: '{"token":"{vault:jwt-1}"}' })
      expect(JSON.stringify(result)).not.toContain(jwt)
    }).pipe(Effect.provideService(SessionModelTransport.Service, transport)),
  )

  it.effect("scrubs progress updates and the metadata of a failure whose message is clean", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const name = yield* vault.put({ projectID: session.projectID, kind: "github-token", value: token })
      const updates: unknown[] = []
      const prepared = yield* prepare((input) =>
        Effect.gen(function* () {
          if (input.progress) yield* input.progress({ line: `sending ${token}`, nested: { list: [token] } })
          return yield* new Tool.Error({ message: "request failed", metadata: { output: `401 for ${token}` } })
        }),
      )
      const error = yield* prepared
        .executeTool({
          ...call("call_vault_progress"),
          progress: (update) => Effect.sync(() => void updates.push(update)),
        })
        .pipe(Effect.flip)
      expect(updates).toEqual([{ line: `sending {vault:${name}}`, nested: { list: [`{vault:${name}}`] } }])
      expect(error.message).toBe("request failed")
      expect(error instanceof Tool.Error ? error.metadata : undefined).toEqual({ output: `401 for {vault:${name}}` })
      expect(JSON.stringify([updates, error])).not.toContain(token)
    }).pipe(Effect.provideService(SessionModelTransport.Service, transport)),
  )

  it.effect("returns a clean failure without metadata as it was", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      yield* vault.put({ projectID: session.projectID, kind: "github-token", value: token })
      const failure = new Tool.Error({ message: "nothing secret here" })
      const prepared = yield* prepare(() => Effect.fail(failure))
      const error = yield* prepared.executeTool(call("call_vault_clean_error")).pipe(Effect.flip)
      expect(error.message).toBe("nothing secret here")
      expect(error instanceof Tool.Error ? error.metadata : "not a tool error").toBeUndefined()
    }).pipe(Effect.provideService(SessionModelTransport.Service, transport)),
  )

  it.effect("neither resolves nor scrubs another project's secret", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const foreign = yield* vault.put({ projectID: otherProject, kind: "github-token", value: token })
      const prepared = yield* prepare(
        () =>
          Effect.gen(function* () {
            const resolved = yield* Vault.resolveAll([foreign])
            return {
              content: [
                { type: "text" as const, text: "missing" in resolved ? `missing ${resolved.missing}` : "resolved" },
              ],
            }
          }),
        [Message.user(`from elsewhere ${token}`)],
      )
      const result = yield* prepared.executeTool(call("call_vault_foreign"))
      expect(result.content).toEqual([{ type: "text", text: `missing ${foreign}` }])
      // The Session's project does not hold this value, so its request carries the text as the user wrote it.
      expect(JSON.stringify(prepared.request.messages)).toContain(token)
      expect(yield* vault.list(session.projectID)).toEqual([])
    }).pipe(Effect.provideService(SessionModelTransport.Service, transport)),
  )
})
