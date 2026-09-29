import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Project } from "@opencode/schema/project"
import { UserPayload } from "@opencode/schema/session-inbox"
import { Vault } from "../src/vault/vault.js"
import { VaultAdmission } from "../src/vault/admission.js"
import { VaultShell } from "../src/vault/shell.js"
import { testEffect } from "./lib/effect"

const it = testEffect(Vault.layer)

// Every fixture is assembled from parts so no secret scanner mistakes it for a real credential.
const token = "ghp" + "_" + "a".repeat(36)
const other = "ghp" + "_" + "b".repeat(36)
const projectA = Project.ID.make("prj_vault_a")
const projectB = Project.ID.make("prj_vault_b")

describe("Vault", () => {
  it.effect("names a value once per project, with stable kind-numbered names", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const first = yield* vault.put({ projectID: projectA, kind: "github-token", value: token })
      const again = yield* vault.put({ projectID: projectA, kind: "github-token", value: token })
      const second = yield* vault.put({ projectID: projectA, kind: "github-token", value: other })
      expect([first, again, second]).toEqual(["github-token-1", "github-token-1", "github-token-2"])
      expect(yield* vault.resolve({ projectID: projectA, name: first })).toBe(token)
      expect((yield* vault.list(projectA)).map((entry) => [entry.name, entry.kind])).toEqual([
        ["github-token-1", "github-token"],
        ["github-token-2", "github-token"],
      ])
      expect(JSON.stringify(yield* vault.list(projectA))).not.toContain(token)
    }),
  )

  it.effect("keeps a secret of one project invisible to another", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const name = yield* vault.put({ projectID: projectA, kind: "github-token", value: token })
      expect(yield* vault.resolve({ projectID: projectB, name })).toBeUndefined()
      expect(yield* vault.list(projectB)).toEqual([])
      expect(yield* vault.scrub(projectB, `echo ${token}`)).toBe(`echo ${token}`)
      expect(yield* vault.forget({ projectID: projectB, name })).toBe(false)
      expect(yield* vault.resolve({ projectID: projectA, name })).toBe(token)
    }),
  )

  it.effect("scrubs every stored value, the longest first", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const short = "hunter" + "2hunter2"
      const long = `${short}-and-more`
      const shortName = yield* vault.put({ projectID: projectA, kind: "password", value: short })
      const longName = yield* vault.put({ projectID: projectA, kind: "password", value: long })
      expect(yield* vault.scrub(projectA, `a=${long} b=${short} c=${short}`)).toBe(
        `a={vault:${longName}} b={vault:${shortName}} c={vault:${shortName}}`,
      )
      expect(yield* vault.scrub(projectA, "nothing to hide")).toBe("nothing to hide")
    }),
  )

  it.effect("returns nothing for an unknown or forgotten name and never reuses a name", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      expect(yield* vault.resolve({ projectID: projectA, name: "github-token-7" })).toBeUndefined()
      const name = yield* vault.put({ projectID: projectA, kind: "github-token", value: token })
      expect(yield* vault.forget({ projectID: projectA, name })).toBe(true)
      expect(yield* vault.resolve({ projectID: projectA, name })).toBeUndefined()
      expect(yield* vault.put({ projectID: projectA, kind: "github-token", value: other })).toBe("github-token-2")
    }),
  )

  it.effect("reads references and resolves them only under a binding", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const name = yield* vault.put({ projectID: projectA, kind: "github-token", value: token })
      expect(vault.references(`use {vault:${name}} twice {vault:${name}} and {vault:api-key-2}`)).toEqual([
        name,
        "api-key-2",
      ])
      expect(yield* Vault.resolveAll([name])).toEqual({ missing: name })
      const bound = yield* Vault.resolveAll([name]).pipe(
        Effect.provideService(Vault.Current, Vault.bind(vault, projectA)),
      )
      expect("values" in bound ? bound.values.get(name) : undefined).toBe(token)
      const foreign = yield* Vault.resolveAll([name]).pipe(
        Effect.provideService(Vault.Current, Vault.bind(vault, projectB)),
      )
      expect(foreign).toEqual({ missing: name })
      expect(Vault.unknownReference("x-1")).toContain("Unknown vault reference {vault:x-1}")
    }),
  )
})

describe("VaultAdmission", () => {
  it.effect("moves high-confidence secrets out of a prompt and keeps everything else", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const checksum = "aB1".repeat(12)
      const text = `Push with GITHUB_TOKEN=${token} but keep checksum=${checksum} as is @build`
      const at = text.indexOf("@build")
      const payload = yield* VaultAdmission.protect(
        vault,
        projectA,
        UserPayload.make({
          text,
          agents: [{ name: "build", mention: { start: at, end: at + 6, text: "@build" } }],
          metadata: { source: "tui" },
        }),
      )
      expect(payload.text).toBe(
        `Push with GITHUB_TOKEN={vault:github-token-1} but keep checksum=${checksum} as is @build`,
      )
      const mention = payload.agents?.[0]?.mention
      expect(mention && payload.text.slice(mention.start, mention.end)).toBe("@build")
      expect(payload.metadata).toEqual({ source: "tui", vault: [{ name: "github-token-1", kind: "github-token" }] })
      expect(JSON.stringify(payload)).not.toContain(token)
      expect(yield* vault.resolve({ projectID: projectA, name: "github-token-1" })).toBe(token)
    }),
  )

  it.effect("drops a mention that covers a secret and protects text attachments", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const text = `see ${token}`
      const attachment = `API_KEY=${"abc" + "123def456"}\n`
      const payload = yield* VaultAdmission.protect(
        vault,
        projectA,
        UserPayload.make({
          text,
          files: [
            {
              data: Buffer.from(attachment).toString("base64"),
              mime: "text/plain",
              source: { type: "inline" },
              name: "notes.txt",
              mention: { start: 4, end: text.length, text: token },
            },
          ],
        }),
      )
      const file = payload.files?.[0]
      expect(file?.mention).toBeUndefined()
      expect(Buffer.from(file?.data ?? "", "base64").toString("utf8")).toBe("API_KEY={vault:api-key-1}\n")
      expect(payload.metadata?.vault).toEqual([
        { name: "github-token-1", kind: "github-token" },
        { name: "api-key-1", kind: "api-key" },
      ])
    }),
  )

  it.effect("returns a prompt without a high-confidence secret unchanged", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const payload = UserPayload.make({ text: `checksum=${"aB1".repeat(12)} and {vault:github-token-1}` })
      expect(yield* VaultAdmission.protect(vault, projectA, payload)).toBe(payload)
      expect(yield* vault.list(projectA)).toEqual([])
    }),
  )
})

describe("VaultShell", () => {
  const values = new Map([["github-token-1", token]])

  it.effect("reads a reference from the child environment in every POSIX quoting", () =>
    Effect.sync(() => {
      const bound = VaultShell.bind(
        `curl -H "Authorization: Bearer {vault:github-token-1}" -u me:{vault:github-token-1} 'x{vault:github-token-1}y' \\{vault:github-token-1}`,
        "/bin/sh",
        values,
      )
      expect(bound.command).toBe(
        `curl -H "Authorization: Bearer \${REDCODE_VAULT_1}" -u me:"\${REDCODE_VAULT_1}" 'x'"\${REDCODE_VAULT_1}"'y' \\{vault:github-token-1}`,
      )
      expect(bound.env).toEqual({ REDCODE_VAULT_1: token })
      expect(bound.command).not.toContain(token)
    }),
  )
})
