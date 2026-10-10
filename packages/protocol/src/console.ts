import { Console } from "@opencode/schema/console"
import { Infrastructure } from "@opencode/schema/infrastructure"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { ConflictError, InvalidRequestError, UnauthorizedError } from "./errors.js"

export class ConsoleForbiddenError extends Schema.TaggedError<ConsoleForbiddenError>()(
  "ConsoleForbiddenError",
  { message: Schema.String },
  { httpApiStatus: 403 },
) {}
export class ConsoleNotFoundError extends Schema.TaggedError<ConsoleNotFoundError>()(
  "ConsoleNotFoundError",
  { message: Schema.String },
  { httpApiStatus: 404 },
) {}
const errors = [
  UnauthorizedError,
  ConsoleForbiddenError,
  ConsoleNotFoundError,
  ConflictError,
  InvalidRequestError,
] as const
const headers = { authorization: Schema.optional(Schema.String) }
const organization = { organizationID: Schema.String }
const workspace = { workspaceID: Schema.String }
const authScope = { scope: Console.AuthScope, scopeID: Schema.String }

export const ConsoleGroup = HttpApiGroup.make("console")
  .add(
    HttpApiEndpoint.get("authSettings", "/api/console/auth/:scope/:scopeID", {
      headers,
      params: authScope,
      success: Console.AuthSettings,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.put("authPublicURL", "/api/console/auth/public-url", {
      headers,
      payload: Schema.Struct({ publicURL: Schema.String.check(Schema.isMaxLength(2048)) }),
      success: Schema.Void,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("authCreateProvider", "/api/console/auth/:scope/:scopeID/providers", {
      headers,
      params: authScope,
      payload: Console.AuthProviderInput,
      success: Console.AuthProvider,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.put("authUpdateProvider", "/api/console/auth/:scope/:scopeID/providers/:providerID", {
      headers,
      params: { ...authScope, providerID: Schema.String },
      payload: Console.AuthProviderInput,
      success: Console.AuthProvider,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.delete("authRemoveProvider", "/api/console/auth/:scope/:scopeID/providers/:providerID", {
      headers,
      params: { ...authScope, providerID: Schema.String },
      success: Schema.Void,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("authTestProvider", "/api/console/auth/:scope/:scopeID/providers/:providerID/test", {
      headers,
      params: { ...authScope, providerID: Schema.String },
      success: Schema.Struct({ callbackURL: Schema.String }),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("infrastructure", "/api/console/infrastructure", {
      headers,
      success: Infrastructure.Snapshot,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("infrastructureClaim", "/api/console/infrastructure", {
      headers,
      payload: Infrastructure.Claim,
      success: Infrastructure.Owner,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("infrastructureMembers", "/api/console/infrastructure/:ownerID/members", {
      headers,
      params: { ownerID: Infrastructure.ID },
      success: Schema.Array(Infrastructure.Member),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.put("infrastructureMember", "/api/console/infrastructure/:ownerID/members", {
      headers,
      params: { ownerID: Infrastructure.ID },
      payload: Schema.Struct({ email: Console.Email, role: Infrastructure.Role }),
      success: Schema.Void,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.delete("infrastructureRemoveMember", "/api/console/infrastructure/:ownerID/members/:accountID", {
      headers,
      params: { ownerID: Infrastructure.ID, accountID: Infrastructure.ID },
      success: Schema.Void,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("infrastructureResource", "/api/console/infrastructure/:ownerID/resources", {
      headers,
      params: { ownerID: Infrastructure.ID },
      payload: Infrastructure.ResourceCreate,
      success: Infrastructure.Resource,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("workspaceResources", "/api/console/workspaces/:workspaceID/resources", {
      headers,
      params: { workspaceID: Infrastructure.ID },
      success: Schema.Array(Infrastructure.Resource),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("infrastructureGrant", "/api/console/resources/:resourceID/grants", {
      headers,
      params: { resourceID: Infrastructure.ID },
      payload: Infrastructure.GrantCreate,
      success: Infrastructure.Grant,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.delete("infrastructureRevoke", "/api/console/resources/:resourceID/grants/:grantID", {
      headers,
      params: { resourceID: Infrastructure.ID, grantID: Infrastructure.ID },
      success: Schema.Void,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("infrastructureAccess", "/api/console/resources/:resourceID/access", {
      headers,
      params: { resourceID: Infrastructure.ID },
      query: Schema.Struct({ workspaceID: Schema.optional(Infrastructure.ID) }),
      success: Infrastructure.Access,
      error: errors,
    }),
  )
  .add(HttpApiEndpoint.get("status", "/api/console/status", { success: Console.Status }))
  .add(
    HttpApiEndpoint.get("identityProviders", "/api/console/federation/providers", {
      headers,
      query: Schema.Struct({
        organizationID: Schema.optional(Schema.String),
        ownerID: Schema.optional(Schema.String),
        account: Schema.optional(Schema.Literal("true")),
      }),
      success: Schema.Array(Console.IdentityProvider),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("identities", "/api/console/identities", {
      headers,
      success: Schema.Array(Console.Identity),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("federationStart", "/api/console/federation/start", {
      headers,
      payload: Console.FederationStart,
      success: Schema.Struct({ url: Schema.String }),
      error: errors,
    }),
  )
  .add(HttpApiEndpoint.get("federationCallback", "/api/console/federation/callback", { success: Schema.Void }))
  .add(
    HttpApiEndpoint.post("federationSession", "/api/console/federation/session", {
      success: Console.Session,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("bootstrap", "/api/console/bootstrap", {
      payload: Console.Bootstrap,
      success: Console.Session,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("login", "/api/console/login", {
      payload: Console.Login,
      success: Console.Session,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("register", "/api/console/register", {
      payload: Console.Register,
      success: Console.Session,
      error: errors,
    }),
  )
  .add(HttpApiEndpoint.get("me", "/api/console/me", { headers, success: Console.Account, error: errors }))
  .add(HttpApiEndpoint.post("logout", "/api/console/logout", { headers, success: Schema.Void, error: errors }))
  .add(
    HttpApiEndpoint.put("password", "/api/console/password", {
      headers,
      payload: Console.PasswordChange,
      success: Console.Session,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteAccount", "/api/console/account", {
      headers,
      payload: Schema.Struct({ currentPassword: Schema.String }),
      success: Schema.Void,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("organizations", "/api/console/orgs", {
      headers,
      success: Schema.Array(Console.Organization),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("createOrganization", "/api/console/orgs", {
      headers,
      payload: Schema.Struct({ name: Console.Name }),
      success: Console.Organization,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("workspaces", "/api/console/orgs/:organizationID/workspaces", {
      headers,
      params: organization,
      success: Schema.Array(Console.Workspace),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("createWorkspace", "/api/console/orgs/:organizationID/workspaces", {
      headers,
      params: organization,
      payload: Schema.Struct({ name: Console.Name }),
      success: Console.Workspace,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("members", "/api/console/orgs/:organizationID/members", {
      headers,
      params: organization,
      success: Schema.Array(Console.Member),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.put("setRole", "/api/console/orgs/:organizationID/members/:accountID", {
      headers,
      params: { ...organization, accountID: Schema.String },
      payload: Schema.Struct({ role: Console.Role }),
      success: Schema.Void,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.delete("removeMember", "/api/console/orgs/:organizationID/members/:accountID", {
      headers,
      params: { ...organization, accountID: Schema.String },
      success: Schema.Void,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("invites", "/api/console/orgs/:organizationID/invites", {
      headers,
      params: organization,
      success: Schema.Array(Console.Invite),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("createInvite", "/api/console/orgs/:organizationID/invites", {
      headers,
      params: organization,
      payload: Console.InviteCreate,
      success: Console.IssuedInvite,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.delete("revokeInvite", "/api/console/orgs/:organizationID/invites/:inviteID", {
      headers,
      params: { ...organization, inviteID: Schema.String },
      success: Schema.Void,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("acceptInvite", "/api/console/invites/accept", {
      headers,
      payload: Schema.Struct({ token: Console.Token }),
      success: Schema.Void,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("keys", "/api/console/workspaces/:workspaceID/keys", {
      headers,
      params: workspace,
      success: Schema.Array(Console.Key),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("createKey", "/api/console/workspaces/:workspaceID/keys", {
      headers,
      params: workspace,
      payload: Console.KeyCreate,
      success: Console.IssuedKey,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.delete("revokeKey", "/api/console/workspaces/:workspaceID/keys/:keyID", {
      headers,
      params: { ...workspace, keyID: Schema.String },
      success: Schema.Void,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("audit", "/api/console/orgs/:organizationID/audit", {
      headers,
      params: organization,
      success: Schema.Array(Console.Audit),
      error: errors,
    }),
  )

// The Console runs on its own listener. Account tokens never authorize agent, shell or filesystem routes.
export const ConsoleApi = HttpApi.make("RedcodeConsole").add(ConsoleGroup)
