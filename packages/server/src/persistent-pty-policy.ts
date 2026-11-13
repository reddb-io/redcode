import { createHash } from "node:crypto"
import { ClientPresence } from "@opencode/schema/client-presence"
import { PersistentPty } from "@opencode/schema/persistent-pty"
import type { Session } from "@opencode/schema/session"
import type { ManagedPolicy } from "@opencode/core/managed-policy"
import type { HttpServerRequest } from "effect/unstable/http"
import { Schema } from "effect"

type Request = HttpServerRequest.HttpServerRequest

export function terminalLaunchBinding(input: {
  readonly request: Request
  readonly session?: Pick<Session.Info, "location" | "permissions" | "projectID">
  readonly sessionID: Session.ID
  readonly policy: ManagedPolicy.State
  readonly credential?: string
  readonly origin?: ClientPresence.Surface
}): PersistentPty.LaunchBinding {
  const surface = input.request.headers[ClientPresence.SURFACE_HEADER]
  const origin =
    input.origin ?? (Schema.is(ClientPresence.Surface)(surface) ? surface : ClientPresence.Surface.make("unknown"))
  const credential = input.credential ?? credentialFingerprint(input.request)
  return PersistentPty.LaunchBinding.make({
    origin,
    policyFingerprint: fingerprint({ managed: input.policy, session: input.session?.permissions ?? [] }),
    scope: {
      server: normalizeHost(input.request.headers.host),
      location: fingerprint(input.session?.location ?? input.request.headers["x-opencode-directory"] ?? "unknown"),
      project: input.session?.projectID ?? input.sessionID,
      credential,
    },
  })
}

function credentialFingerprint(request: Request) {
  const authorization = request.headers.authorization
  if (authorization) return fingerprint({ authorization })
  const cookies = Object.entries(request.cookies).sort(([left], [right]) => left.localeCompare(right))
  if (cookies.length > 0) return fingerprint({ cookies })
  return fingerprint({ anonymous: true })
}

function normalizeHost(host: string | undefined) {
  return (host ?? "local").trim().toLowerCase()
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex").slice(0, 24)
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`
  return JSON.stringify(value) ?? "null"
}
