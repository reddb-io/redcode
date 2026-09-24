import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import path from "path"
import { Effect, Layer, Option, Record, Result, Schema, Context } from "effect"
import { NonNegativeInt } from "@reddb-io/redcode-core/schema"
import { Global } from "@reddb-io/redcode-core/global"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { Credential } from "@reddb-io/redcode-core/credential"
import { Integration } from "@reddb-io/redcode-schema/integration"

export { OAUTH_DUMMY_KEY } from "./dummy-key"

const file = path.join(Global.Path.data, "auth.json")

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

export class Oauth extends Schema.Class<Oauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
}) {}

export class Api extends Schema.Class<Api>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
}) {}

export const Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
export type Info = Schema.Schema.Type<typeof Info>

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface Interface {
  readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  readonly remove: (key: string) => Effect.Effect<void, AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/Auth") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* FSUtil.Service
    const credentials = yield* Credential.Service
    const decode = Schema.decodeUnknownOption(Info)
    const decodeContent = Schema.decodeUnknownOption(
      Schema.UnknownFromJsonString.pipe(Schema.decodeTo(Schema.Record(Schema.String, Schema.Unknown))),
    )

    const all = Effect.fn("Auth.all")(function* () {
      if (process.env.REDCODE_AUTH_CONTENT) {
        const content = decodeContent(process.env.REDCODE_AUTH_CONTENT)
        if (Option.isSome(content)) {
          return Record.filterMap(content.value, (value) => Result.fromOption(decode(value), () => undefined))
        }
      }

      const data = (yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))) as Record<string, unknown>
      return Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
    })

    const get = Effect.fn("Auth.get")(function* (providerID: string) {
      return (yield* all())[providerID]
    })

    const mirror = Effect.fn("Auth.mirror")(function* (providerID: string, info: Info | undefined, existing = false) {
      const integrationID = Integration.ID.make(providerID)
      const current = yield* credentials.list(integrationID)
      if (existing && current.length) return
      const value = credentialValue(info)
      // Re-saving a connection (a new key, a router refresh adding metadata) keeps its credential id,
      // so settings that name it, such as the System One evaluator, stay valid.
      const kept = value ? current.at(-1) : undefined
      yield* Effect.forEach(
        current.filter((credential) => credential !== kept),
        (credential) => credentials.remove(credential.id),
        { discard: true },
      )
      if (!value) return
      if (kept) return yield* credentials.update(kept.id, { value, label: "Provider connection" })
      yield* credentials.create({ integrationID, value, label: "Provider connection" })
    })

    const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* all()
      if (norm !== key) delete data[key]
      delete data[norm + "/"]
      yield* fsys
        .writeJson(file, { ...data, [norm]: info }, 0o600)
        .pipe(Effect.mapError(fail("Failed to write auth data")))
      yield* mirror(norm, info)
    })

    const remove = Effect.fn("Auth.remove")(function* (key: string) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* all()
      delete data[key]
      delete data[norm]
      yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
      yield* mirror(norm, undefined)
    })

    yield* Effect.forEach(Object.entries(yield* all()), ([providerID, info]) => mirror(providerID, info, true), {
      discard: true,
    })
    return Service.of({ get, all, set, remove })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [FSUtil.node, Credential.node] })

function credentialValue(info: Info | undefined): Credential.Value | undefined {
  if (info?.type === "api") return { type: "key", key: info.key, metadata: info.metadata }
  if (info?.type !== "oauth") return
  return {
    type: "oauth",
    methodID: Integration.MethodID.make("oauth"),
    refresh: info.refresh,
    access: info.access,
    expires: info.expires,
    metadata: {
      ...(info.accountId ? { accountId: info.accountId } : {}),
      ...(info.enterpriseUrl ? { enterpriseUrl: info.enterpriseUrl } : {}),
    },
  }
}

export * as Auth from "."
