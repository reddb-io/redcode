import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Project } from "@opencode/schema/project"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Instructions } from "@opencode/core/instructions/index"
import { Vault } from "@opencode/core/vault/vault"
import { VaultInstructions } from "@opencode/core/vault/instructions"
import { it } from "./lib/effect"
import { readInitial, readUpdate } from "./lib/instructions"

// Assembled from parts so no secret scanner mistakes it for a real credential.
const token = "ghp" + "_" + "i".repeat(36)
const projectA = Project.ID.make("prj_vault_instructions_a")
const projectB = Project.ID.make("prj_vault_instructions_b")

// A fresh in-memory vault for every test.
const provided = <A, E>(effect: Effect.Effect<A, E, VaultInstructions.Service | Vault.Service>) =>
  effect.pipe(Effect.provide(AppNodeBuilder.build(LayerNode.group([Vault.node, VaultInstructions.node]))))

describe("VaultInstructions", () => {
  it.effect("explains the vault only to an agent with a tool that resolves references", () =>
    provided(
      Effect.gen(function* () {
        const context = yield* VaultInstructions.Service
        const withSinks = yield* readInitial(context.load(projectA, { sinks: true }))
        expect(withSinks.text).toBe(VaultInstructions.GUIDE)
        expect(VaultInstructions.GUIDE.split(/\s+/).length).toBeLessThan(200)
        expect((yield* readInitial(context.load(projectA, { sinks: false }))).text).toBe("")
        // Resume and compaction render the same baseline from the stored value.
        expect(Instructions.renderInitial(context.load(projectA, { sinks: true }), withSinks.values)).toBe(
          withSinks.text,
        )
      }),
    ),
  )

  it.effect("withdraws guidance and names when disabled, without forgetting secrets", () =>
    provided(
      Effect.gen(function* () {
        const vault = yield* Vault.Service
        const context = yield* VaultInstructions.Service
        yield* vault.set({ projectID: projectA, name: "github-token", value: token, origin: "user" })
        const enabled = yield* readInitial(context.load(projectA, { sinks: true }))
        const disabled = context.load(projectA, { sinks: true, enabled: false })
        expect((yield* readInitial(disabled)).text).toBe("")
        expect((yield* readUpdate(disabled, enabled)).changed).toBe(true)
        expect(yield* vault.resolve({ projectID: projectA, name: "github-token" })).toBe(token)
      }),
    ),
  )

  it.effect("lists the project's references, never values, and delivers additions and removals as updates", () =>
    provided(
      Effect.gen(function* () {
        const vault = yield* Vault.Service
        const context = yield* VaultInstructions.Service
        const load = () => context.load(projectA, { sinks: false })
        const empty = yield* readInitial(load())
        expect(empty.text).toBe("")

        const name = yield* vault.set({ projectID: projectA, name: "github-token", value: token, origin: "user" })
        const added = yield* readUpdate(load(), empty)
        expect(added.text).toBe(
          "Vault references in this project (values are never shown):\n- {vault:github-token} (github-token)",
        )
        const steady = yield* readUpdate(load(), added)
        expect(steady.changed).toBe(false)

        yield* vault.allow({ projectID: projectA, name, destination: "api.github.com" })
        const bound = yield* readUpdate(load(), added)
        expect(bound.text).toBe(
          "The project vault changed. It now holds these references:\n- {vault:github-token} (github-token; may go to api.github.com without asking)",
        )

        yield* vault.forget({ projectID: projectA, name })
        expect((yield* readUpdate(load(), bound)).text).toBe(
          "The project vault is now empty; earlier references no longer resolve.",
        )
        expect(JSON.stringify([added, bound])).not.toContain(token)
      }),
    ),
  )

  it.effect("tells an agent that loses its sinks that references no longer resolve", () =>
    provided(
      Effect.gen(function* () {
        const context = yield* VaultInstructions.Service
        const withSinks = yield* readInitial(context.load(projectA, { sinks: true }))
        const without = yield* readUpdate(context.load(projectA, { sinks: false }), withSinks)
        expect(without.text).toBe("Vault references no longer resolve for you; do not write them.")
        expect((yield* readUpdate(context.load(projectA, { sinks: false }), without)).changed).toBe(false)
        expect(Array.from(VaultInstructions.SINKS).toSorted()).toEqual([
          "edit",
          "patch",
          "shell",
          "vault_request",
          "webfetch",
          "write",
        ])
      }),
    ),
  )

  it.effect("lists names sorted, with the hosts each may go to, in the initial baseline", () =>
    provided(
      Effect.gen(function* () {
        const vault = yield* Vault.Service
        const context = yield* VaultInstructions.Service
        yield* vault.set({ projectID: projectA, name: "zeta-key", value: token, origin: "user" })
        yield* vault.set({ projectID: projectA, name: "alpha-key", value: "other-" + token, origin: "user" })
        yield* vault.allow({ projectID: projectA, name: "zeta-key", destination: "b.example" })
        yield* vault.allow({ projectID: projectA, name: "zeta-key", destination: "a.example" })
        const initial = yield* readInitial(context.load(projectA, { sinks: false }))
        expect(initial.text).toBe(
          [
            "Vault references in this project (values are never shown):",
            "- {vault:alpha-key} (alpha-key)",
            "- {vault:zeta-key} (zeta-key; may go to a.example, b.example without asking)",
          ].join("\n"),
        )
        expect(initial.text).not.toContain(token)
      }),
    ),
  )

  it.effect("never shows another project's names", () =>
    provided(
      Effect.gen(function* () {
        const vault = yield* Vault.Service
        const context = yield* VaultInstructions.Service
        yield* vault.set({ projectID: projectA, name: "github-token", value: token, origin: "user" })
        expect((yield* readInitial(context.load(projectB, { sinks: false }))).text).toBe("")
        expect((yield* readInitial(context.load(projectA, { sinks: false }))).text).toContain("{vault:github-token}")
      }),
    ),
  )
})
