import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Project } from "@opencode/schema/project"
import { Vault } from "../src/vault/vault.js"
import type { VaultEnvFile } from "../src/vault/env-file.js"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

// Assembled from parts so no secret scanner mistakes the fixtures for real credentials.
const token = "ghp" + "_" + "a".repeat(36)
const other = "ghp" + "_" + "b".repeat(36)
const password = "hunter" + "-" + "correct-horse"
const project = Project.ID.make("prj_vault_env")
const directory = "/work/app/src"

/** A `.env` file held in memory, so a test can read what the vault wrote and edit the file behind its back. */
const file = (initial?: string) => {
  const state = { text: initial, writes: 0, reads: 0 }
  const store: VaultEnvFile.Store = {
    read: () =>
      Effect.sync(() => {
        state.reads += 1
        return state.text
      }),
    update: (_directory, edit) =>
      Effect.sync(() => {
        const next = edit(state.text ?? "")
        if (next === undefined) return false
        state.text = next
        state.writes += 1
        return true
      }),
  }
  return { state, store }
}

const attached = (env: ReturnType<typeof file>) =>
  Effect.gen(function* () {
    const vault = Vault.make(env.store, { refreshMs: 0 })
    yield* vault.attach({ projectID: project, directory })
    return vault
  })

describe("Vault over a .env file", () => {
  it.effect("reads the file's variables as references and scrubs only what looks like a secret", () =>
    Effect.gen(function* () {
      const env = file(
        [
          "# app",
          `GITHUB_TOKEN=${token}`,
          "PORT=3000",
          `export DB_PASSWORD="${password}"`,
          "NODE_ENV=production",
          "EMPTY=",
        ].join("\n"),
      )
      const vault = yield* attached(env)

      expect((yield* vault.list(project)).map((entry) => [entry.name, entry.kind])).toEqual([
        ["github-token", "env"],
        ["port", "env"],
        ["db-password", "env"],
        ["node-env", "env"],
      ])
      expect(yield* vault.resolve({ projectID: project, name: "github-token" })).toBe(token)
      expect(yield* vault.resolve({ projectID: project, name: "port" })).toBe("3000")
      expect(yield* vault.scrub(project, `PORT 3000 in production with ${token} and ${password}`)).toBe(
        "PORT 3000 in production with {vault:github-token} and {vault:db-password}",
      )
    }),
  )

  it.effect(
    "scrubs a credential-named variable however short its value is not, and a recognized secret whatever its name",
    () =>
      Effect.gen(function* () {
        const env = file(`API_SECRET=short\nSTRIPE_ACCOUNT=${token}\nSESSION_KEY=${"abcd1234".repeat(2)}\n`)
        const vault = yield* attached(env)
        // Under 8 characters is never scrubbed: a common word would corrupt every later tool result.
        expect(yield* vault.scrub(project, "short")).toBe("short")
        expect(yield* vault.scrub(project, token)).toBe("{vault:stripe-account}")
        expect(yield* vault.scrub(project, "abcd1234".repeat(2))).toBe("{vault:session-key}")
      }),
  )

  it.effect(
    "writes what the user pastes under the variable it was assigned to, and reads it back after a restart",
    () =>
      Effect.gen(function* () {
        const env = file("PORT=3000\n")
        const vault = yield* attached(env)

        const named = yield* vault.put({ projectID: project, kind: "github-token", value: token, name: "GITHUB_TOKEN" })
        const unnamed = yield* vault.put({ projectID: project, kind: "github-token", value: other })

        expect([named, unnamed]).toEqual(["github-token", "github-token-1"])
        expect(env.state.text).toBe(`PORT=3000\nGITHUB_TOKEN=${token}\nGITHUB_TOKEN_1=${other}\n`)
        // The same value again is the same reference, and writes nothing.
        const writes = env.state.writes
        expect(yield* vault.put({ projectID: project, kind: "github-token", value: token, name: "OTHER_NAME" })).toBe(
          "github-token",
        )
        expect(env.state.writes).toBe(writes)

        const restarted = yield* attached(env)
        expect((yield* restarted.list(project)).map((entry) => entry.name)).toEqual([
          "port",
          "github-token",
          "github-token-1",
        ])
        // A new name after the restart does not reuse one the file already holds.
        const next = yield* restarted.put({ projectID: project, kind: "github-token", value: "ghp_" + "c".repeat(36) })
        expect(next).toBe("github-token-2")
      }),
  )

  it.effect("keeps the name free for another value when the preferred one is held", () =>
    Effect.gen(function* () {
      const env = file(`GITHUB_TOKEN=${token}\n`)
      const vault = yield* attached(env)
      const name = yield* vault.put({ projectID: project, kind: "github-token", value: other, name: "GITHUB_TOKEN" })
      expect(name).toBe("github-token-1")
      expect(yield* vault.resolve({ projectID: project, name: "github-token" })).toBe(token)
      expect(env.state.text).toBe(`GITHUB_TOKEN=${token}\nGITHUB_TOKEN_1=${other}\n`)
    }),
  )

  it.effect("replaces a variable in place when the user sets it", () =>
    Effect.gen(function* () {
      const env = file(`A=1\nGITHUB_TOKEN=${token}\nB=2\n`)
      const vault = yield* attached(env)
      const name = yield* vault.set({ projectID: project, name: "GITHUB_TOKEN", value: other, origin: "user" })
      expect(name).toBe("github-token")
      expect(env.state.text).toBe(`A=1\nGITHUB_TOKEN=${other}\nB=2\n`)
      expect(yield* vault.scrub(project, `${token} ${other}`)).toBe(`${token} {vault:github-token}`)
    }),
  )

  it.effect("keeps a captured value in memory only", () =>
    Effect.gen(function* () {
      const env = file("A=1\n")
      const vault = yield* attached(env)
      const name = yield* vault.set({ projectID: project, name: "access-token", value: token, origin: "captured" })
      expect(env.state.text).toBe("A=1\n")
      expect(yield* vault.resolve({ projectID: project, name })).toBe(token)
      // A file that changes later does not take a captured value away.
      env.state.text = "A=2\n"
      expect(yield* vault.resolve({ projectID: project, name })).toBe(token)
      expect(yield* vault.forget({ projectID: project, name })).toBe(true)
      expect(env.state.text).toBe("A=2\n")
    }),
  )

  it.effect("removes the variable when the user forgets a name", () =>
    Effect.gen(function* () {
      const env = file(`A=1\nGITHUB_TOKEN=${token}\n`)
      const vault = yield* attached(env)
      expect(yield* vault.forget({ projectID: project, name: "github-token" })).toBe(true)
      expect(env.state.text).toBe("A=1\n")
      expect(yield* vault.forget({ projectID: project, name: "github-token" })).toBe(false)
      expect(yield* vault.resolve({ projectID: project, name: "github-token" })).toBeUndefined()
    }),
  )

  it.effect("follows edits made to the file behind its back", () =>
    Effect.gen(function* () {
      const env = file(`GITHUB_TOKEN=${token}\nGONE=value-that-goes\n`)
      const vault = yield* attached(env)
      env.state.text = `GITHUB_TOKEN=${other}\nADDED=${password}\n`
      expect(yield* vault.resolve({ projectID: project, name: "github-token" })).toBe(other)
      expect(yield* vault.resolve({ projectID: project, name: "gone" })).toBeUndefined()
      expect(yield* vault.resolve({ projectID: project, name: "added" })).toBe(password)
      env.state.text = undefined
      expect(yield* vault.list(project)).toEqual([])
    }),
  )

  it.effect("reads the file at most once per refresh window", () =>
    Effect.gen(function* () {
      const env = file(`GITHUB_TOKEN=${token}\n`)
      const vault = Vault.make(env.store)
      yield* vault.attach({ projectID: project, directory })
      yield* vault.resolve({ projectID: project, name: "github-token" })
      yield* vault.list(project)
      yield* vault.scrub(project, token)
      expect(env.state.reads).toBe(1)
    }),
  )

  it.effect("keeps a value the file cannot hold in memory", () =>
    Effect.gen(function* () {
      const env = file("A=1\n")
      const vault = yield* attached(env)
      const awkward = `it's "$x" ok`
      const name = yield* vault.set({ projectID: project, name: "awkward", value: awkward, origin: "user" })
      expect(env.state.text).toBe("A=1\n")
      expect(yield* vault.resolve({ projectID: project, name })).toBe(awkward)
    }),
  )

  it.effect("re-reads when a Session attaches another directory", () =>
    Effect.gen(function* () {
      const env = file(`A=${password}\n`)
      const vault = Vault.make(env.store)
      yield* vault.attach({ projectID: project, directory })
      env.state.text = `B=${password}\n`
      yield* vault.attach({ projectID: project, directory: "/work/app/other" })
      expect((yield* vault.list(project)).map((entry) => entry.name)).toEqual(["b"])
    }),
  )

  it.effect("has no file for the global project or for a project nobody attached", () =>
    Effect.gen(function* () {
      const env = file("A=1\n")
      const vault = Vault.make(env.store, { refreshMs: 0 })
      yield* vault.attach({ projectID: Project.ID.global, directory })
      yield* vault.put({ projectID: Project.ID.global, kind: "github-token", value: token })
      yield* vault.put({ projectID: project, kind: "github-token", value: other })
      expect(env.state.text).toBe("A=1\n")
      expect(env.state.reads).toBe(0)
      expect(yield* vault.list(project)).toHaveLength(1)
    }),
  )

  it.effect("stays in memory without a store", () =>
    Effect.gen(function* () {
      const vault = Vault.make()
      yield* vault.attach({ projectID: project, directory })
      const name = yield* vault.put({ projectID: project, kind: "github-token", value: token, name: "GITHUB_TOKEN" })
      expect(name).toBe("github-token")
      expect(yield* vault.forget({ projectID: project, name })).toBe(true)
    }),
  )

  it.effect("does not write when the file system refuses", () =>
    Effect.gen(function* () {
      const store: VaultEnvFile.Store = { read: () => Effect.succeed(undefined), update: () => Effect.succeed(false) }
      const vault = Vault.make(store, { refreshMs: 0 })
      yield* vault.attach({ projectID: project, directory })
      const name = yield* vault.put({ projectID: project, kind: "github-token", value: token, name: "GITHUB_TOKEN" })
      expect(yield* vault.resolve({ projectID: project, name })).toBe(token)
      // Never persisted, so it survives the file being read again as empty.
      expect(yield* vault.resolve({ projectID: project, name })).toBe(token)
    }),
  )
})
