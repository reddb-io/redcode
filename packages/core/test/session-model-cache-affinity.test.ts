import { expect, test } from "bun:test"
import { Effect } from "effect"
import { Credential } from "@opencode/schema/credential"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Session } from "@opencode/schema/session"
import { promptCacheAffinity } from "@opencode/core/session/model-request"

const root = Session.ID.make("ses_cache_root")
const ref = (providerID: string, credential?: string) =>
  Model.Ref.make({
    id: Model.ID.make("model"),
    providerID: Provider.ID.make(providerID),
    ...(credential
      ? { connection: { type: "credential" as const, id: Credential.ID.make(credential) } }
      : {}),
  })

test("prompt cache affinity is stable within and isolated across providers, accounts, and roots", async () => {
  const first = await Effect.runPromise(promptCacheAffinity(root, ref("openai", "cred_one")))
  expect(await Effect.runPromise(promptCacheAffinity(root, ref("openai", "cred_one")))).toBe(first)
  expect(await Effect.runPromise(promptCacheAffinity(root, ref("anthropic", "cred_one")))).not.toBe(first)
  expect(await Effect.runPromise(promptCacheAffinity(root, ref("openai", "cred_two")))).not.toBe(first)
  expect(
    await Effect.runPromise(promptCacheAffinity(Session.ID.make("ses_other_root"), ref("openai", "cred_one"))),
  ).not.toBe(first)
  expect(first).toMatch(/^[0-9a-f]{64}$/)
})
