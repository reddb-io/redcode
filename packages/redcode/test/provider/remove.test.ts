import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Auth } from "../../src/auth"
import { ProviderRemove } from "../../src/provider/remove"
import type { Credential } from "@reddb-io/redcode-core/credential"
import type { Intelligence } from "@reddb-io/redcode-core/intelligence"
import type { ModelLimit } from "@reddb-io/redcode-core/model-limit"
import { ProviderRouter } from "@reddb-io/redcode-core/provider/router"
import { TestConfig } from "../fixture/config"

type Settings = Effect.Success<ReturnType<Intelligence.Interface["read"]>>
type Write = { patch: Record<string, unknown>; remove: ReadonlyArray<ReadonlyArray<string>> | undefined }

const BASE_URL = "http://127.0.0.1:47001/v1"

function fakes(
  input: {
    data?: Record<string, unknown>
    auth?: Record<string, Auth.Info>
    settings?: Record<string, unknown>
    credentials?: Record<string, string>
    limits?: Array<[string, string]>
    env?: Record<string, string>
  } = {},
) {
  const calls: string[] = []
  const writes: Write[] = []
  const saved: unknown[] = []
  const forgotten: Array<[string, string]> = []
  const credentials: Record<string, Auth.Info> = { ...input.auth }
  const config = TestConfig.make({
    readGlobalFile: () => Effect.succeed({ path: "/home/test/.red/code/config.jsonc", data: input.data ?? {} }),
    updateGlobal: (next, options) =>
      Effect.sync(() => {
        calls.push("config")
        writes.push({ patch: next as Record<string, unknown>, remove: options?.remove })
        return { info: next, changed: true }
      }),
  })
  const auth = {
    get: (key: string) => Effect.succeed(credentials[key]),
    remove: (key: string) =>
      Effect.sync(() => {
        calls.push(`auth.remove:${key}`)
        delete credentials[key]
      }),
  } as unknown as Auth.Interface
  const deps = {
    config,
    auth,
    credentials: {
      get: (id: string) =>
        Effect.succeed(
          input.credentials?.[id] === undefined
            ? undefined
            : ({ id, integrationID: input.credentials[id] } as unknown as Credential.Info),
        ),
    } as unknown as Pick<Credential.Interface, "get">,
    intelligence: {
      read: () => Effect.succeed((input.settings ?? { enabled: false, onboarding: "pending" }) as Settings),
      save: (next: { settings: Settings }) =>
        Effect.sync(() => {
          calls.push("intelligence")
          saved.push(next.settings)
          return next.settings
        }),
    } as unknown as Pick<Intelligence.Interface, "read" | "save">,
    limits: {
      list: () =>
        Effect.succeed((input.limits ?? []).map(([providerID, modelID]) => ({ providerID, modelID, observed: {} }))),
      forget: (providerID: string, modelID: string) =>
        Effect.sync(() => {
          forgotten.push([providerID, modelID])
        }),
    } as unknown as Pick<ModelLimit.Interface, "list" | "forget">,
    envNames: ["GONE_API_KEY", "GONE_TOKEN"],
    env: (name: string) => (input.env ?? { GONE_API_KEY: "set" })[name],
  }
  return { calls, writes, saved, forgotten, credentials, deps }
}

const everything = (env?: Record<string, string>) =>
  fakes({
    env,
    data: {
      provider: { gone: { name: "Gone", options: { baseURL: BASE_URL } }, keep: { name: "Keep" } },
      model: "gone/a",
      small_model: "gone/b",
      agent: { build: { model: "gone/c" }, plan: { model: "keep/d" }, bare: {} },
      command: { review: { model: "gone/e", template: "x" }, other: { model: "keep/f" } },
      enabled_providers: ["gone", "keep"],
      disabled_providers: ["gone"],
    },
    auth: { gone: { type: "api", key: "gone-key" } as Auth.Info },
    settings: {
      enabled: true,
      reasoning: "dual",
      onboarding: "completed",
      principal: { providerID: "gone", id: "x" },
      evaluator: {
        transport: "red-router",
        baseURL: "http://localhost:47001/v1",
        model: "jev",
        credentialID: "cred_1",
      },
    },
    credentials: { cred_1: "gone" },
    limits: [
      ["gone", "a"],
      ["keep", "d"],
    ],
  })

const REMOVED = {
  credential: true,
  config: true,
  references: [
    "default model",
    "small model",
    "agent build",
    "command review",
    "enabled providers",
    "S2 principal",
    "S1 evaluator",
    "dual reasoning (turned off until set up again in /setup)",
  ],
  learnedLimits: 1,
  hidden: true,
}

describe("ProviderRemove.remove", () => {
  test("clears the credential, the configuration entry and every setting that names the provider", async () => {
    const fake = everything()
    ProviderRouter.recordCatalog("gone", BASE_URL, "catalog-1")
    const result = await Effect.runPromise(ProviderRemove.remove(fake.deps, "gone"))

    expect(result).toEqual({
      providerID: "gone",
      dryRun: false,
      removed: REMOVED,
      configPath: "/home/test/.red/code/config.jsonc",
      referencingFiles: [],
      envVariables: ["GONE_API_KEY"],
    })
    expect(fake.calls).toEqual(["config", "auth.remove:gone", "intelligence"])
    expect(fake.writes).toEqual([
      {
        patch: { enabled_providers: ["keep"] },
        remove: [
          ["provider", "gone"],
          ["model"],
          ["small_model"],
          ["agent", "build", "model"],
          ["command", "review", "model"],
        ],
      },
    ])
    expect(fake.credentials).toEqual({})
    // Dual reasoning lost the models it needs, so it waits for /setup instead of failing every turn.
    expect(fake.saved).toEqual([
      { enabled: false, reasoning: "dual", onboarding: "completed" },
    ])
    expect(fake.forgotten).toEqual([["gone", "a"]])
    // The recorded catalog version was forgotten, so the same version counts as new again.
    expect(ProviderRouter.catalogChanged("gone", BASE_URL, "catalog-1")).toBe(true)
  })

  test("a dry run reports the same removal and changes nothing", async () => {
    const fake = everything()
    const result = await Effect.runPromise(ProviderRemove.remove(fake.deps, "gone", { dryRun: true }))

    expect(result.dryRun).toBe(true)
    expect(result.removed).toEqual(REMOVED)
    expect(result.envVariables).toEqual(["GONE_API_KEY"])
    expect(fake.calls).toEqual([])
    expect(fake.writes).toEqual([])
    expect(fake.saved).toEqual([])
    expect(fake.forgotten).toEqual([])
    expect(fake.credentials).toEqual({ gone: { type: "api", key: "gone-key" } })
  })

  test("keeps an evaluator with its own key and clears a keyless one at the provider's address", async () => {
    const own = fakes({
      data: { provider: { gone: { options: { baseURL: BASE_URL } } } },
      settings: {
        enabled: true,
        onboarding: "completed",
        evaluator: { transport: "red-router", baseURL: BASE_URL, model: "jev", credentialID: "cred_own" },
      },
      credentials: { cred_own: "intelligence:red-router" },
    })
    const kept = await Effect.runPromise(ProviderRemove.remove(own.deps, "gone"))
    expect(kept.removed.references).toEqual([])
    expect(own.saved).toEqual([])

    const keyless = fakes({
      data: { provider: { gone: { options: { baseURL: BASE_URL } } } },
      settings: {
        enabled: true,
        reasoning: "single",
        onboarding: "completed",
        evaluator: { transport: "red-router", baseURL: `${BASE_URL}/`, model: "jev" },
      },
    })
    const cleared = await Effect.runPromise(ProviderRemove.remove(keyless.deps, "gone"))
    expect(cleared.removed.references).toEqual(["S1 evaluator"])
    expect(keyless.saved).toEqual([{ enabled: true, reasoning: "single", onboarding: "completed" }])
  })

  test("without an environment variable that loads it, the provider leaves disabled_providers", async () => {
    const fake = everything({})
    const result = await Effect.runPromise(ProviderRemove.remove(fake.deps, "gone"))
    expect(result.removed.hidden).toBe(false)
    expect(result.envVariables).toEqual([])
    expect(result.removed.references).toContain("disabled providers")
    expect(fake.writes[0].remove).toContainEqual(["disabled_providers"])
  })

  test("a provider the environment loads is hidden through disabled_providers so the removal sticks", async () => {
    const fake = fakes({ data: { disabled_providers: ["other"] }, env: { AWS_PROFILE: "work" } })
    const deps = { ...fake.deps, envNames: ["AWS_PROFILE", "AWS_ACCESS_KEY_ID"] }
    const preview = await Effect.runPromise(ProviderRemove.remove(deps, "gone", { dryRun: true }))
    expect(preview.removed).toEqual({
      credential: false,
      config: false,
      references: [],
      learnedLimits: 0,
      hidden: true,
    })
    expect(preview.envVariables).toEqual(["AWS_PROFILE"])
    expect(fake.writes).toEqual([])

    const result = await Effect.runPromise(ProviderRemove.remove(deps, "gone"))
    expect(result.removed.hidden).toBe(true)
    expect(fake.writes).toEqual([{ patch: { disabled_providers: ["other", "gone"] }, remove: [] }])
    expect(fake.calls).toEqual(["config", "auth.remove:gone"])
    // Connecting it again takes it off the list.
    expect(ProviderRemove.enabling({ disabled_providers: ["other", "gone"] }, "gone")).toEqual({
      patch: { disabled_providers: ["other"] },
      remove: [],
    })
  })
})

describe("ProviderRemove.enabling", () => {
  test("takes the provider off disabled_providers and drops a list left empty", () => {
    expect(ProviderRemove.enabling({ disabled_providers: ["gone", "other"] }, "gone")).toEqual({
      patch: { disabled_providers: ["other"] },
      remove: [],
    })
    expect(ProviderRemove.enabling({ disabled_providers: ["gone"] }, "gone")).toEqual({
      patch: {},
      remove: [["disabled_providers"]],
    })
    expect(ProviderRemove.enabling({ disabled_providers: ["other"] }, "gone")).toBeUndefined()
    expect(ProviderRemove.enabling({}, "gone")).toBeUndefined()
  })
})
