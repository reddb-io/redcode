export * as ConsoleFederation from "./federation.js"

import { Console } from "@opencode/core/console"
import { ConsoleCrypto } from "@opencode/core/console/crypto"
import { ConsoleAuthentication } from "@opencode/core/console/authentication"
import { optional } from "@opencode/schema/schema"
import { Context, Duration, Effect, Layer, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import {
  allowInsecureRequests,
  authorizationCodeGrantRequest,
  calculatePKCECodeChallenge,
  ClientSecretBasic,
  ClientSecretPost,
  customFetch,
  discoveryRequest,
  generateRandomCodeVerifier,
  getValidatedIdTokenClaims,
  None,
  processAuthorizationCodeResponse,
  processDiscoveryResponse,
  processUserInfoResponse,
  userInfoRequest,
  validateApplicationLevelSignature,
  validateAuthResponse,
} from "oauth4webapi"

const Provider = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9-]{1,100}$/)),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  issuer: Schema.String,
  clientID: Schema.String.check(Schema.isMinLength(1)),
  tokenAuthMethod: optional(Schema.Literals(["client_secret_basic", "client_secret_post", "none"])),
})
export interface Options {
  readonly publicURL: string
  readonly providers: readonly (Schema.Schema.Type<typeof Provider> & {
    readonly clientSecret?: string
    readonly scope?: "global" | "organization" | "infrastructure"
    readonly scopeID?: string
  })[]
}

function safeURL(value: string) {
  const url = new URL(value)
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
  )
    throw new Error("Console OIDC URLs require HTTPS (HTTP is allowed only on loopback)")
  return url
}
export function validate(options: Options) {
  const origin = safeURL(options.publicURL)
  if (origin.pathname !== "/") throw new Error("Console publicURL must be an origin without a path")
  const ids = options.providers.map((provider) => provider.id)
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error("Configure unique OIDC provider IDs")
  options.providers.forEach((provider) => {
    safeURL(provider.issuer)
    if (provider.tokenAuthMethod !== "none" && !provider.clientSecret)
      throw new Error(`Missing client secret for OIDC provider ${provider.id}; public clients must explicitly use none`)
    if (provider.tokenAuthMethod === "none" && provider.clientSecret)
      throw new Error(`Public OIDC provider ${provider.id} must not have a client secret`)
  })
  return options
}

const make = Effect.fn("ConsoleFederation.make")(function* (options?: Options) {
  const console = yield* Console.Service
  const authentication = yield* ConsoleAuthentication.Service
  if (options) validate(options)
  const configuration = () =>
    authentication
      .runtime()
      .pipe(
        Effect.map((stored) => ({
          publicURL: stored.publicURL ?? options?.publicURL,
          providers: [...stored.providers, ...(options?.providers ?? [])],
        })),
      )
  const flowCookie = (secure: boolean) => (secure ? "__Host-redcode-console-flow" : "redcode-console-flow")
  const handoffCookie = (secure: boolean) => (secure ? "__Host-redcode-console-handoff" : "redcode-console-handoff")
  const cookie = (name: string, value: string, maxAge: number, secure: boolean) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`
  const readCookie = (request: HttpServerRequest.HttpServerRequest, name: string) =>
    request.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(name + "="))
      ?.slice(name.length + 1) ?? ""
  const invalid = () => new Error("Federated sign-in failed. Sign in again or contact your administrator.")
  const requireOrigin = (request: HttpServerRequest.HttpServerRequest, origin?: string) => {
    if (!origin || request.headers.origin !== origin) throw invalid()
  }
  const providerFor = (id: string, providers: Options["providers"]) => {
    const provider = providers.find((provider) => provider.id === id)
    if (!provider) throw invalid()
    return provider
  }
  const network = {
    // Discovery and provider endpoints are operator configured; redirects must not receive client credentials.
    [customFetch]: (input: string | URL | Request, init?: RequestInit) =>
      fetch(input, {
        ...init,
        redirect: "error",
        signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      }),
    [allowInsecureRequests]: true,
  }
  const discover = async (provider: Options["providers"][number]) => {
    const issuer = safeURL(provider.issuer)
    const metadata = await processDiscoveryResponse(issuer, await discoveryRequest(issuer, network))
    for (const endpoint of [
      metadata.authorization_endpoint,
      metadata.token_endpoint,
      metadata.jwks_uri,
      metadata.userinfo_endpoint,
    ]) {
      if (endpoint && safeURL(endpoint).protocol === "http:" && issuer.protocol !== "http:") throw invalid()
    }
    return metadata
  }
  return {
    providers: (token: string, organizationID?: string, ownerID?: string, account = false) =>
      authentication
        .publicProviders(token, organizationID, ownerID, account)
        .pipe(
          Effect.map((stored) => [
            ...stored,
            ...(options?.providers.map(({ id, name, issuer }) => ({ id, name, issuer })) ?? []),
          ]),
        ),
    test: (token: string, scope: "global" | "organization" | "infrastructure", scopeID: string, providerID: string) =>
      Effect.gen(function* () {
        const settings = yield* authentication.settings(token, scope, scopeID)
        const found = settings.providers.find((provider) => provider.id === providerID)
        if (!found) return yield* Effect.fail(new Error("Identity provider not found"))
        yield* Effect.tryPromise({
          try: () => discover({ ...found }),
          catch: () => new Error("Unable to discover the identity provider; check its issuer URL and network access"),
        })
        return { callbackURL: settings.publicURL + "/api/console/federation/callback" }
      }),
    start: Effect.fn("ConsoleFederation.start")(function* (
      request: HttpServerRequest.HttpServerRequest,
      input: { readonly providerID: string; readonly inviteToken?: string; readonly link?: boolean },
      token: string,
    ) {
      const config = yield* configuration()
      const origin = config.publicURL
      const secure = origin?.startsWith("https:") ?? false
      const callbackURI = `${origin}/api/console/federation/callback`
      const result = yield* Effect.tryPromise({
        try: async () => {
          requireOrigin(request, origin)
          const provider = providerFor(input.providerID, config.providers)
          const metadata = await discover(provider)
          if (!metadata.authorization_endpoint) throw invalid()
          const state = ConsoleCrypto.token("rdcf_")
          const browser = ConsoleCrypto.token("rdcb_")
          const nonce = ConsoleCrypto.token("rdcn_")
          const verifier = generateRandomCodeVerifier()
          const url = new URL(metadata.authorization_endpoint)
          url.search = new URLSearchParams({
            client_id: provider.clientID,
            redirect_uri: callbackURI,
            response_type: "code",
            scope: "openid email profile",
            state,
            nonce,
            code_challenge: await calculatePKCECodeChallenge(verifier),
            code_challenge_method: "S256",
            ...(input.link ? { prompt: "login" } : {}),
          }).toString()
          return {
            url: url.href,
            browser,
            attempt: {
              state_hash: await ConsoleCrypto.digest(state),
              browser_hash: await ConsoleCrypto.digest(browser),
              provider_id: provider.id,
              issuer: metadata.issuer,
              client_id: provider.clientID,
              scope_kind: provider.scope ?? null,
              scope_id: provider.scopeID ?? null,
              verifier,
              nonce,
              expires_at: Date.now() + 600000,
            },
          }
        },
        catch: invalid,
      })
      if (input.link && !token) return yield* Effect.fail(invalid())
      yield* console.federationStart(result.attempt, input.inviteToken, input.link ? token : undefined)
      return HttpServerResponse.jsonUnsafe(
        { url: result.url },
        { headers: { "set-cookie": cookie(flowCookie(secure), result.browser, 600, secure) } },
      )
    }),
    callback: (request: HttpServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        const config = yield* configuration()
        const origin = config.publicURL
        const secure = origin?.startsWith("https:") ?? false
        const callbackURI = `${origin}/api/console/federation/callback`
        if (!origin) return yield* Effect.fail(invalid())
        const url = new URL(request.url, origin)
        const attempt = yield* console.federationConsume(
          url.searchParams.get("state") ?? "",
          readCookie(request, flowCookie(secure)),
        )
        const profile = yield* Effect.tryPromise({
          try: async () => {
            const provider = providerFor(attempt.provider_id, config.providers)
            if (provider.clientID !== attempt.client_id) throw invalid()
            const metadata = await discover(provider)
            if (metadata.issuer !== attempt.issuer) throw invalid()
            const client = { client_id: provider.clientID }
            const auth =
              provider.tokenAuthMethod === "none"
                ? None()
                : provider.tokenAuthMethod === "client_secret_post"
                  ? ClientSecretPost(provider.clientSecret!)
                  : ClientSecretBasic(provider.clientSecret!)
            const parameters = validateAuthResponse(metadata, client, url, url.searchParams.get("state")!)
            const response = await authorizationCodeGrantRequest(
              metadata,
              client,
              auth,
              parameters,
              callbackURI,
              attempt.verifier,
              network,
            )
            const result = await processAuthorizationCodeResponse(metadata, client, response, {
              expectedNonce: attempt.nonce,
              requireIdToken: true,
            })
            await validateApplicationLevelSignature(metadata, response, network)
            const claims = getValidatedIdTokenClaims(result)!
            const info = metadata.userinfo_endpoint
              ? await processUserInfoResponse(
                  metadata,
                  client,
                  claims.sub,
                  await userInfoRequest(metadata, client, result.access_token, network),
                )
              : claims
            return {
              subject: claims.sub,
              email: typeof info.email === "string" ? info.email : undefined,
              name: typeof info.name === "string" ? info.name : undefined,
              verified: info.email_verified === true,
            }
          },
          catch: invalid,
        })
        const session = yield* console.federationComplete(attempt, profile)
        return HttpServerResponse.redirect("/?federation=success").pipe(
          HttpServerResponse.setCookieUnsafe(flowCookie(secure), "", {
            path: "/",
            httpOnly: true,
            sameSite: "lax",
            secure,
            maxAge: Duration.seconds(0),
          }),
          HttpServerResponse.setCookieUnsafe(handoffCookie(secure), session.token, {
            path: "/",
            httpOnly: true,
            sameSite: "lax",
            secure,
            maxAge: Duration.seconds(60),
          }),
          HttpServerResponse.setHeader("referrer-policy", "no-referrer"),
        )
      }).pipe(
        Effect.catch(() =>
          configuration().pipe(
            Effect.map((config) => {
              const secure = config.publicURL?.startsWith("https:") ?? false
              return HttpServerResponse.redirect("/?federation=failed").pipe(
                HttpServerResponse.setCookieUnsafe(flowCookie(secure), "", {
                  path: "/",
                  httpOnly: true,
                  sameSite: "lax",
                  secure,
                  maxAge: Duration.seconds(0),
                }),
                HttpServerResponse.setCookieUnsafe(handoffCookie(secure), "", {
                  path: "/",
                  httpOnly: true,
                  sameSite: "lax",
                  secure,
                  maxAge: Duration.seconds(0),
                }),
                HttpServerResponse.setHeader("referrer-policy", "no-referrer"),
              )
            }),
          ),
        ),
      ),
    session: Effect.fn("ConsoleFederation.session")(function* (request: HttpServerRequest.HttpServerRequest) {
      const config = yield* configuration()
      const secure = config.publicURL?.startsWith("https:") ?? false
      yield* Effect.try({ try: () => requireOrigin(request, config.publicURL), catch: invalid })
      const result = yield* console.federationSession(readCookie(request, handoffCookie(secure)))
      return HttpServerResponse.jsonUnsafe(result, {
        headers: { "set-cookie": cookie(handoffCookie(secure), "", 0, secure) },
      })
    }),
  }
})
export type Interface = Effect.Success<ReturnType<typeof make>>
export class Service extends Context.Service<Service, Interface>()("@redcode/ConsoleFederation") {}
export const layer = (options?: Options) => Layer.effect(Service, make(options))
