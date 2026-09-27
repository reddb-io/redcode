export * as ConsoleOrganization from "./console-organization.js"

import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Credential } from "./credential.js"
import { Integration } from "./integration.js"

const Org = Schema.Struct({ id: Schema.String, name: Schema.String })
const defaultServer = "https://opencode.ai/console"

export const list = Effect.fn("ConsoleOrganization.list")(function* (credentialID?: Credential.ID) {
  const integration = yield* Integration.Service
  const credentials = yield* Credential.Service
  const active = yield* integration.connection.active(Integration.ID.make("opencode"))
  const connections = (yield* integration.get(Integration.ID.make("opencode")))?.connections.filter(
    (connection) => connection.type === "credential" && (!credentialID || connection.id === credentialID),
  ) ?? []
  const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
  const accounts = yield* Effect.forEach(
    connections,
    (connection) =>
      Effect.gen(function* () {
        const saved = yield* credentials.get(connection.id)
        if (!saved || saved.value.type !== "oauth") return
        const resolved = integration.connection.resolve(connection)
        const value = yield* (credentialID ? resolved : resolved.pipe(Effect.orElseSucceed(() => saved.value)))
        if (!value || value.type !== "oauth") return
        const server = typeof value.metadata?.server === "string" ? value.metadata.server : defaultServer
        const fetched = http
          .execute(
            HttpClientRequest.get(`${server}/api/orgs`).pipe(
              HttpClientRequest.acceptJson,
              HttpClientRequest.bearerToken(value.access),
            ),
          )
          .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Array(Org))))
        const orgs = yield* (credentialID ? fetched : fetched.pipe(Effect.orElseSucceed(() => [])))
        return {
          credentialID: connection.id,
          server,
          email: typeof value.metadata?.email === "string" ? value.metadata.email : saved.label,
          active: active?.type === "credential" && active.id === connection.id,
          activeID: typeof value.metadata?.orgID === "string" ? value.metadata.orgID : undefined,
          orgs: orgs.toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
        }
      }),
    { concurrency: 3 },
  )
  return accounts.filter((account): account is NonNullable<typeof account> => account !== undefined)
})

export const select = Effect.fn("ConsoleOrganization.select")(function* (credentialID: Credential.ID, orgID: string) {
  const account = (yield* list(credentialID))[0]
  if (!account) return yield* Effect.fail(new Error(`OpenCode Console account not found: ${credentialID}`))
  const org = account.orgs.find((item) => item.id === orgID)
  if (!org) return yield* Effect.fail(new Error(`OpenCode organization not found: ${orgID}`))
  const credentials = yield* Credential.Service
  const credential = yield* credentials.get(account.credentialID)
  if (!credential || credential.value.type !== "oauth")
    return yield* Effect.fail(new Error("The OpenCode Console account is unavailable"))
  if (credential.value.metadata?.orgID !== org.id || credential.value.metadata?.orgName !== org.name)
    yield* credentials.update(credential.id, {
      value: Credential.OAuth.make({
        ...credential.value,
        metadata: { ...credential.value.metadata, orgID: org.id, orgName: org.name },
      }),
    })
  if (!account.active) yield* credentials.activate(credential.id)
  return org
})
