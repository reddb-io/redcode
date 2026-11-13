import { expect } from "bun:test"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Vault } from "@opencode/core/vault/vault"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

it.effect("redacts project Vault values and unvaulted credentials for plugins", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const host = yield* PluginHost.make(plugins)
    const vault = yield* Vault.Service
    const vaulted = "opaque-project-secret-that-patterns-do-not-need-to-recognize"
    const key = "sk-" + "Ab3".repeat(16)

    const name = yield* vault.set({
      projectID: host.location.project.id,
      name: "plugin-export",
      value: vaulted,
      origin: "user",
    })
    const output = yield* host.redactText(`vault=${vaulted}\nAuthorization: Bearer ${key}`)

    expect(output).toContain(Vault.reference(name))
    expect(output).not.toContain(vaulted)
    expect(output).not.toContain(key)
    expect(output).toContain("[redacted:openai-key]")
  }),
)
