import { Console } from "@opencode/core/console"
import { ConsoleInfrastructure } from "@opencode/core/console/infrastructure"
import { ConsoleAuthentication } from "@opencode/core/console/authentication"
import { ConsoleApi, ConsoleForbiddenError, ConsoleNotFoundError } from "@opencode/protocol/console"
import { ConflictError, InvalidRequestError, UnauthorizedError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { HttpServerRequest } from "effect/unstable/http"
import { ConsoleFederation } from "./federation.js"

const error = (failure: { code: string; message: string }) => {
  if (failure.code === "unauthorized") return new UnauthorizedError({ message: failure.message })
  if (failure.code === "forbidden") return new ConsoleForbiddenError({ message: failure.message })
  if (failure.code === "not_found") return new ConsoleNotFoundError({ message: failure.message })
  if (failure.code === "conflict") return new ConflictError({ message: failure.message })
  return new InvalidRequestError({ message: failure.message })
}
const token = (headers: { readonly authorization?: string }) =>
  headers.authorization?.startsWith("Bearer ") ? headers.authorization.slice(7) : ""

export const ConsoleHandler = HttpApiBuilder.group(ConsoleApi, "console", (handlers) =>
  Effect.gen(function* () {
    const console = yield* Console.Service
    const infrastructure = yield* ConsoleInfrastructure.Service
    const federation = yield* ConsoleFederation.Service
    const authentication = yield* ConsoleAuthentication.Service
    return handlers
      .handle("authSettings", (ctx) =>
        authentication.settings(token(ctx.headers), ctx.params.scope, ctx.params.scopeID).pipe(Effect.mapError(error)),
      )
      .handle("authPublicURL", (ctx) =>
        authentication.setURL(token(ctx.headers), ctx.payload.publicURL).pipe(Effect.mapError(error)),
      )
      .handle("authCreateProvider", (ctx) =>
        authentication
          .save(token(ctx.headers), ctx.params.scope, ctx.params.scopeID, ctx.payload)
          .pipe(Effect.mapError(error)),
      )
      .handle("authUpdateProvider", (ctx) =>
        authentication
          .save(token(ctx.headers), ctx.params.scope, ctx.params.scopeID, ctx.payload, ctx.params.providerID)
          .pipe(Effect.mapError(error)),
      )
      .handle("authRemoveProvider", (ctx) =>
        authentication
          .remove(token(ctx.headers), ctx.params.scope, ctx.params.scopeID, ctx.params.providerID)
          .pipe(Effect.mapError(error)),
      )
      .handle("authTestProvider", (ctx) =>
        federation
          .test(token(ctx.headers), ctx.params.scope, ctx.params.scopeID, ctx.params.providerID)
          .pipe(
            Effect.mapError((failure) =>
              "code" in failure && typeof failure.code === "string"
                ? error({ code: failure.code, message: failure.message })
                : new InvalidRequestError({ message: failure.message }),
            ),
          ),
      )
      .handle("infrastructure", (ctx) => infrastructure.snapshot(token(ctx.headers)).pipe(Effect.mapError(error)))
      .handle("infrastructureClaim", (ctx) =>
        infrastructure.claim(token(ctx.headers), ctx.payload).pipe(Effect.mapError(error)),
      )
      .handle("infrastructureMembers", (ctx) =>
        infrastructure.members(token(ctx.headers), ctx.params.ownerID).pipe(Effect.mapError(error)),
      )
      .handle("infrastructureMember", (ctx) =>
        infrastructure
          .setMember(token(ctx.headers), ctx.params.ownerID, ctx.payload.email, ctx.payload.role)
          .pipe(Effect.mapError(error)),
      )
      .handle("infrastructureRemoveMember", (ctx) =>
        infrastructure
          .removeMember(token(ctx.headers), ctx.params.ownerID, ctx.params.accountID)
          .pipe(Effect.mapError(error)),
      )
      .handle("infrastructureResource", (ctx) =>
        infrastructure.register(token(ctx.headers), ctx.params.ownerID, ctx.payload).pipe(Effect.mapError(error)),
      )
      .handle("workspaceResources", (ctx) =>
        infrastructure.workspaceResources(token(ctx.headers), ctx.params.workspaceID).pipe(Effect.mapError(error)),
      )
      .handle("infrastructureGrant", (ctx) =>
        infrastructure.grant(token(ctx.headers), ctx.params.resourceID, ctx.payload).pipe(Effect.mapError(error)),
      )
      .handle("infrastructureRevoke", (ctx) =>
        infrastructure
          .revoke(token(ctx.headers), ctx.params.resourceID, ctx.params.grantID)
          .pipe(Effect.mapError(error)),
      )
      .handle("infrastructureAccess", (ctx) =>
        infrastructure
          .access(token(ctx.headers), ctx.params.resourceID, ctx.query.workspaceID)
          .pipe(Effect.mapError(error)),
      )
      .handle("status", () => console.status())
      .handle("identityProviders", (ctx) =>
        federation
          .providers(token(ctx.headers), ctx.query.organizationID, ctx.query.ownerID, ctx.query.account === "true")
          .pipe(Effect.mapError(error)),
      )
      .handle("identities", (ctx) => console.identities(token(ctx.headers)).pipe(Effect.mapError(error)))
      .handle("federationStart", (ctx) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          return yield* federation.start(request, ctx.payload, token(ctx.headers))
        }).pipe(Effect.mapError(() => new UnauthorizedError({ message: "Unable to start federated sign-in" }))),
      )
      .handleRaw("federationCallback", () =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          return yield* federation.callback(request)
        }),
      )
      .handleRaw("federationSession", () =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          return yield* federation.session(request)
        }).pipe(Effect.mapError(() => new UnauthorizedError({ message: "Sign-in handoff expired; sign in again" }))),
      )
      .handle("bootstrap", (ctx) => console.bootstrap(ctx.payload).pipe(Effect.mapError(error)))
      .handle("login", (ctx) => console.login(ctx.payload).pipe(Effect.mapError(error)))
      .handle("register", (ctx) => console.register(ctx.payload).pipe(Effect.mapError(error)))
      .handle("me", (ctx) => console.me(token(ctx.headers)).pipe(Effect.mapError(error)))
      .handle("logout", (ctx) => console.logout(token(ctx.headers)).pipe(Effect.mapError(error)))
      .handle("password", (ctx) => console.changePassword(token(ctx.headers), ctx.payload).pipe(Effect.mapError(error)))
      .handle("deleteAccount", (ctx) =>
        console.deleteAccount(token(ctx.headers), ctx.payload.currentPassword).pipe(Effect.mapError(error)),
      )
      .handle("organizations", (ctx) => console.organizations(token(ctx.headers)).pipe(Effect.mapError(error)))
      .handle("createOrganization", (ctx) =>
        console.createOrganization(token(ctx.headers), ctx.payload.name).pipe(Effect.mapError(error)),
      )
      .handle("workspaces", (ctx) =>
        console.workspaces(token(ctx.headers), ctx.params.organizationID).pipe(Effect.mapError(error)),
      )
      .handle("createWorkspace", (ctx) =>
        console
          .createWorkspace(token(ctx.headers), ctx.params.organizationID, ctx.payload.name)
          .pipe(Effect.mapError(error)),
      )
      .handle("members", (ctx) =>
        console.members(token(ctx.headers), ctx.params.organizationID).pipe(Effect.mapError(error)),
      )
      .handle("setRole", (ctx) =>
        console
          .setRole(token(ctx.headers), ctx.params.organizationID, ctx.params.accountID, ctx.payload.role)
          .pipe(Effect.mapError(error)),
      )
      .handle("removeMember", (ctx) =>
        console
          .removeMember(token(ctx.headers), ctx.params.organizationID, ctx.params.accountID)
          .pipe(Effect.mapError(error)),
      )
      .handle("invites", (ctx) =>
        console.invites(token(ctx.headers), ctx.params.organizationID).pipe(Effect.mapError(error)),
      )
      .handle("createInvite", (ctx) =>
        console.createInvite(token(ctx.headers), ctx.params.organizationID, ctx.payload).pipe(Effect.mapError(error)),
      )
      .handle("revokeInvite", (ctx) =>
        console
          .revokeInvite(token(ctx.headers), ctx.params.organizationID, ctx.params.inviteID)
          .pipe(Effect.mapError(error)),
      )
      .handle("acceptInvite", (ctx) =>
        console.acceptInvite(token(ctx.headers), ctx.payload.token).pipe(Effect.mapError(error)),
      )
      .handle("keys", (ctx) => console.keys(token(ctx.headers), ctx.params.workspaceID).pipe(Effect.mapError(error)))
      .handle("createKey", (ctx) =>
        console.createKey(token(ctx.headers), ctx.params.workspaceID, ctx.payload).pipe(Effect.mapError(error)),
      )
      .handle("revokeKey", (ctx) =>
        console.revokeKey(token(ctx.headers), ctx.params.workspaceID, ctx.params.keyID).pipe(Effect.mapError(error)),
      )
      .handle("audit", (ctx) =>
        console.audit(token(ctx.headers), ctx.params.organizationID).pipe(Effect.mapError(error)),
      )
  }),
)
