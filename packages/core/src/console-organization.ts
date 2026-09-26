export * as ConsoleOrganization from "./console-organization.js"

import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Credential } from "./credential.js"
import { Integration } from "./integration.js"

const Org = Schema.Struct({ id: Schema.String, name: Schema.String })
const defaultServer = "https://opencode.ai/console"

export const list = Effect.fn("ConsoleOrganization.list")(function* () {
  const integration = yield* Integration.Service
  const connection = yield* integration.connection.active(Integration.ID.make("opencode"))
  if (!connection || connection.type !== "credential")
    return yield* Effect.fail(new Error("No active OpenCode Console account"))
  const credential = yield* integration.connection.resolve(connection)
  if (!credential || credential.type !== "oauth")
    return yield* Effect.fail(new Error("The active OpenCode Console account does not support organizations"))

  const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
  const server = typeof credential.metadata?.server === "string" ? credential.metadata.server : defaultServer
  const orgs = yield* http
    .execute(
      HttpClientRequest.get(`${server}/api/orgs`).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bearerToken(credential.access),
      ),
    )
    .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Array(Org))))

  return {
    server,
    email: typeof credential.metadata?.email === "string" ? credential.metadata.email : undefined,
    activeID: typeof credential.metadata?.orgID === "string" ? credential.metadata.orgID : undefined,
    orgs: orgs.toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    credentialID: connection.id,
  }
})

export const select = Effect.fn("ConsoleOrganization.select")(function* (orgID: string) {
  const account = yield* list()
  const org = account.orgs.find((item) => item.id === orgID)
  if (!org) return yield* Effect.fail(new Error(`OpenCode organization not found: ${orgID}`))
  const credentials = yield* Credential.Service
  const credential = yield* credentials.get(account.credentialID)
  if (!credential || credential.value.type !== "oauth")
    return yield* Effect.fail(new Error("The active OpenCode Console account is unavailable"))
  if (credential.value.metadata?.orgID === org.id && credential.value.metadata?.orgName === org.name) return org
  yield* credentials.update(credential.id, {
    value: Credential.OAuth.make({
      ...credential.value,
      metadata: { ...credential.value.metadata, orgID: org.id, orgName: org.name },
    }),
  })
  return org
})
