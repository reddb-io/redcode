import { describe, expect } from "bun:test"
import path from "path"
import { DateTime, Effect, Schema } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { VaultPlugin } from "@opencode/core/plugin/vault"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { Provider } from "@opencode/core/provider"
import { Rpc } from "@opencode/core/rpc"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionMessageTable, SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { Vault } from "@opencode/core/vault/vault"
import { tempLocationLayer } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { host } from "./host"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      Session.node,
      Vault.node,
      Location.node,
      FSUtil.node,
      Rpc.node,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      Location.node.replace(tempLocationLayer),
    ],
  ),
)

// Every fixture is assembled from parts so no secret scanner mistakes it for a real credential.
const token = "ghp" + "_" + "r".repeat(36)
const password = "pass" + "word-" + "9f8e7d6c5b"
const otherProject = Project.ID.make("prj_vault_rpc_other")
const sessionID = Session.ID.make("ses_vault_rpc")
const foreignID = Session.ID.make("ses_vault_rpc_foreign")

const encodeMessage = Schema.encodeSync(SessionMessage.Info)

/** A projected message row, written directly so the test needs no runner to promote it. */
const row = (session: Session.ID, message: SessionMessage.Info, seq: number) => {
  const { id: _, type, ...data } = encodeMessage(message)
  return { id: message.id, session_id: session, type, seq, time_created: 0, data }
}

const user = (text: string) =>
  SessionMessage.User.make({
    id: SessionMessage.ID.create(),
    type: "user",
    text,
    time: { created: DateTime.makeUnsafe(0) },
  })

const assistant = () =>
  SessionMessage.Assistant.make({
    id: SessionMessage.ID.create(),
    type: "assistant",
    agent: Agent.ID.make("build"),
    model: { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") },
    content: [],
    time: { created: DateTime.makeUnsafe(0) },
  })

/** Two Sessions: one in the location's project, one in another project, and the plugin registered on a real RPC. */
const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const location = yield* Location.Service
  yield* db
    .insert(ProjectTable)
    .values([
      { id: Project.ID.global, worktree: AbsolutePath.make(location.directory), sandboxes: [] },
      { id: otherProject, worktree: AbsolutePath.make("/other"), sandboxes: [] },
    ])
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values([
      {
        id: sessionID,
        project_id: Project.ID.global,
        slug: "vault",
        directory: location.directory,
        title: "vault",
        version: "test",
      },
      { id: foreignID, project_id: otherProject, slug: "other", directory: "/other", title: "other", version: "test" },
    ])
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  const rpc = yield* Rpc.Service
  yield* VaultPlugin.Plugin.effect(host({ rpc: Object.assign(rpc.client, { register: rpc.register }) }))
  return { rpc, db, directory: location.directory }
})

const call = (rpc: Rpc.Interface, method: string, input: unknown) => rpc.call(Vault.Definition.id, method, input)

describe("redcode.vault RPC", () => {
  it.effect("stores a secret for the location's project when no Session is named, and lists it without its value", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const vault = yield* Vault.Service
      expect(yield* call(fixture.rpc, "set", { name: "GITHUB_TOKEN", value: token })).toBe("github-token")
      expect(yield* vault.resolve({ projectID: Project.ID.global, name: "github-token" })).toBe(token)
      const listed = yield* call(fixture.rpc, "list", { sessionID })
      expect(listed).toMatchObject([{ name: "github-token", kind: "github-token" }])
      expect(JSON.stringify(listed)).not.toContain(token)
    }),
  )

  it.effect("keeps each Session's project apart for set, list and forget", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const vault = yield* Vault.Service
      expect(yield* call(fixture.rpc, "set", { sessionID: foreignID, name: "db-password", value: password })).toBe(
        "db-password",
      )
      expect(yield* vault.resolve({ projectID: otherProject, name: "db-password" })).toBe(password)
      expect(yield* vault.resolve({ projectID: Project.ID.global, name: "db-password" })).toBeUndefined()
      expect(yield* call(fixture.rpc, "list", { sessionID })).toEqual([])
      expect(yield* call(fixture.rpc, "forget", { sessionID, name: "db-password" })).toBe(false)
      expect(yield* call(fixture.rpc, "forget", { sessionID: foreignID, name: "db-password" })).toBe(true)
      expect(yield* call(fixture.rpc, "forget", { sessionID: foreignID, name: "db-password" })).toBe(false)
      expect(yield* call(fixture.rpc, "list", { sessionID: foreignID })).toEqual([])
    }),
  )

  it.effect("replaces a user secret under the same name and falls back to a generated name for an unusable one", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const vault = yield* Vault.Service
      expect(yield* call(fixture.rpc, "set", { sessionID, name: "api-key", value: password })).toBe("api-key")
      expect(yield* call(fixture.rpc, "set", { sessionID, name: "api-key", value: token })).toBe("api-key")
      expect(yield* vault.resolve({ projectID: Project.ID.global, name: "api-key" })).toBe(token)
      expect(yield* call(fixture.rpc, "set", { sessionID, name: "!!!", value: password })).toBe("secret-1")
    }),
  )

  it.effect("imports a .env file on the server, returning names and the skipped count, never a value", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const vault = yield* Vault.Service
      yield* Effect.promise(() =>
        Bun.write(
          path.join(fixture.directory, "app.env"),
          [
            "# credentials",
            `GITHUB_TOKEN=${token}`,
            `export DB_PASSWORD="${password}"`,
            "EMPTY=",
            'MULTI="first',
            'line"',
            `GITHUB_TOKEN=${password}`,
          ].join("\n"),
        ),
      )
      // A relative path resolves against the routed location, as the CLI sends an absolute one.
      const imported = yield* call(fixture.rpc, "import", { path: "app.env" })
      expect(imported).toEqual({ names: ["github-token", "db-password", "github-token"], skipped: 3 })
      expect(JSON.stringify(imported)).not.toContain(token)
      expect(JSON.stringify(imported)).not.toContain(password)
      // A later duplicate key is the user's own newer value, so it replaces the earlier one.
      expect(yield* vault.resolve({ projectID: Project.ID.global, name: "github-token" })).toBe(password)
      expect(yield* vault.resolve({ projectID: Project.ID.global, name: "db-password" })).toBe(password)
    }),
  )

  it.effect("reports a missing or unreadable file without storing anything", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      expect(yield* call(fixture.rpc, "import", { sessionID, path: "missing.env" })).toEqual({
        names: [],
        skipped: 0,
        unreadable: true,
      })
      // A directory cannot be read as text either.
      expect(yield* call(fixture.rpc, "import", { sessionID, path: fixture.directory })).toEqual({
        names: [],
        skipped: 0,
        unreadable: true,
      })
      expect(yield* call(fixture.rpc, "list", { sessionID })).toEqual([])
    }),
  )

  it.effect("withholds a user message once, by recording it in the Session metadata", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const sessions = yield* Session.Service
      const message = user("the server password is " + "banana" + "123")
      yield* fixture.db
        .insert(SessionMessageTable)
        .values(row(sessionID, message, 1))
        .run()
        .pipe(Effect.orDie)
      expect(yield* call(fixture.rpc, "withhold", { sessionID, messageID: message.id })).toBe(true)
      expect((yield* sessions.get(sessionID)).metadata?.restricted).toEqual({ [message.id]: "withheld" })
      expect(yield* call(fixture.rpc, "withhold", { sessionID, messageID: message.id })).toBe(false)
      // History keeps the original text; only later requests replace it.
      const stored = yield* sessions.message({ sessionID, messageID: message.id })
      expect(stored?.type === "user" ? stored.text : "").toContain("banana")
    }),
  )

  it.effect("refuses to withhold an assistant message, another Session's message, or an ID that is no message", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const sessions = yield* Session.Service
      const reply = assistant()
      const foreign = user("elsewhere")
      yield* fixture.db
        .insert(SessionMessageTable)
        .values([row(sessionID, reply, 2), row(foreignID, foreign, 1)])
        .run()
        .pipe(Effect.orDie)
      expect(yield* call(fixture.rpc, "withhold", { sessionID, messageID: reply.id })).toBe(false)
      expect(yield* call(fixture.rpc, "withhold", { sessionID, messageID: foreign.id })).toBe(false)
      expect(yield* call(fixture.rpc, "withhold", { sessionID, messageID: "not-a-message" })).toBe(false)
      expect(yield* call(fixture.rpc, "withhold", { sessionID, messageID: "msg_missing" })).toBe(false)
      expect((yield* sessions.get(sessionID)).metadata?.restricted).toBeUndefined()
      expect((yield* sessions.get(foreignID)).metadata?.restricted).toBeUndefined()
    }),
  )

  it.effect("fails every Session-scoped method for an unknown Session without naming a value", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const vault = yield* Vault.Service
      const missing = Session.ID.make("ses_vault_rpc_missing")
      const failures = yield* Effect.forEach(
        [
          ["list", { sessionID: missing }],
          ["forget", { sessionID: missing, name: "github-token" }],
          ["set", { sessionID: missing, name: "github-token", value: token }],
          ["import", { sessionID: missing, path: "app.env" }],
          ["withhold", { sessionID: missing, messageID: "msg_missing" }],
        ] as const,
        ([method, input]) => call(fixture.rpc, method, input).pipe(Effect.flip),
      )
      expect(failures.map((failure) => failure.type)).toEqual([
        "rpc.internal",
        "rpc.internal",
        "rpc.internal",
        "rpc.internal",
        "rpc.internal",
      ])
      expect(JSON.stringify(failures)).not.toContain(token)
      expect(yield* vault.list(Project.ID.global)).toEqual([])
    }),
  )

  it.effect("rejects input the definition does not accept", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const failure = yield* call(fixture.rpc, "set", { name: "github-token" }).pipe(Effect.flip)
      expect(failure.type).toBe("rpc.invalid_input")
    }),
  )
})
