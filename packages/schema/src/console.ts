export * as Console from "./console.js"

import { Schema } from "effect"
import { optional } from "./schema.js"

export const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100), Schema.isPattern(/\S/))
export const Email = Schema.String.check(Schema.isMaxLength(254), Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/))
export const Password = Schema.String.check(Schema.isMinLength(8), Schema.isMaxLength(256))
export const Role = Schema.Literals(["owner", "admin", "member"])
export type Role = typeof Role.Type
export const Token = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))

export const Account = Schema.Struct({
  id: Schema.String,
  email: Email,
  name: Name,
  createdAt: Schema.Number,
  localPassword: optional(Schema.Boolean),
})
export interface Account extends Schema.Schema.Type<typeof Account> {}
export const Organization = Schema.Struct({ id: Schema.String, name: Name, role: Role, createdAt: Schema.Number })
export interface Organization extends Schema.Schema.Type<typeof Organization> {}
export const Workspace = Schema.Struct({
  id: Schema.String,
  organizationID: Schema.String,
  name: Name,
  createdAt: Schema.Number,
})
export interface Workspace extends Schema.Schema.Type<typeof Workspace> {}
export const Member = Schema.Struct({ accountID: Schema.String, email: Email, name: Name, role: Role })
export interface Member extends Schema.Schema.Type<typeof Member> {}
export const Session = Schema.Struct({ token: Token, expiresAt: Schema.Number, account: Account })
export interface Session extends Schema.Schema.Type<typeof Session> {}
export const Invite = Schema.Struct({ id: Schema.String, email: Email, role: Role, expiresAt: Schema.Number })
export interface Invite extends Schema.Schema.Type<typeof Invite> {}
export const IssuedInvite = Schema.Struct({ invite: Invite, token: Token })
export interface IssuedInvite extends Schema.Schema.Type<typeof IssuedInvite> {}
export const Key = Schema.Struct({
  id: Schema.String,
  workspaceID: Schema.String,
  accountID: Schema.String,
  name: Name,
  prefix: Schema.String,
  createdAt: Schema.Number,
  expiresAt: optional(Schema.Number),
})
export interface Key extends Schema.Schema.Type<typeof Key> {}
export const IssuedKey = Schema.Struct({ key: Key, token: Token })
export interface IssuedKey extends Schema.Schema.Type<typeof IssuedKey> {}
export const Audit = Schema.Struct({
  id: Schema.String,
  actorID: Schema.String,
  action: Schema.String,
  resourceID: Schema.String,
  createdAt: Schema.Number,
})
export interface Audit extends Schema.Schema.Type<typeof Audit> {}
export const Status = Schema.Struct({
  needsSetup: Schema.Boolean,
  billing: Schema.Literal(false),
  sso: Schema.Boolean,
  gateway: Schema.Literal(false),
})
export interface Status extends Schema.Schema.Type<typeof Status> {}

export const IdentityProvider = Schema.Struct({ id: Name, name: Name, issuer: Schema.String })
export interface IdentityProvider extends Schema.Schema.Type<typeof IdentityProvider> {}
export const AuthScope = Schema.Literals(["global", "organization", "infrastructure"])
export type AuthScope = typeof AuthScope.Type
export const AuthProviderInput = Schema.Struct({
  name: Name,
  issuer: Schema.String.check(Schema.isMaxLength(2048)),
  clientID: Name,
  clientSecret: optional(Schema.String.check(Schema.isMaxLength(4096))),
  tokenAuthMethod: Schema.Literals(["client_secret_basic", "client_secret_post", "none"]),
  enabled: Schema.Boolean,
})
export interface AuthProviderInput extends Schema.Schema.Type<typeof AuthProviderInput> {}
export const AuthProvider = Schema.Struct({
  id: Schema.String,
  name: Name,
  issuer: Schema.String,
  clientID: Name,
  tokenAuthMethod: Schema.Literals(["client_secret_basic", "client_secret_post", "none"]),
  enabled: Schema.Boolean,
  hasSecret: Schema.Boolean,
  scope: AuthScope,
  scopeID: Schema.String,
})
export interface AuthProvider extends Schema.Schema.Type<typeof AuthProvider> {}
export const AuthSettings = Schema.Struct({
  publicURL: optional(Schema.String),
  providers: Schema.Array(AuthProvider),
  inherited: Schema.Array(IdentityProvider),
})
export interface AuthSettings extends Schema.Schema.Type<typeof AuthSettings> {}
export const FederationStart = Schema.Struct({
  providerID: Name,
  inviteToken: optional(Token),
  link: optional(Schema.Boolean),
})
export interface FederationStart extends Schema.Schema.Type<typeof FederationStart> {}
export const Identity = Schema.Struct({ issuer: Schema.String, subject: Schema.String, createdAt: Schema.Number })
export interface Identity extends Schema.Schema.Type<typeof Identity> {}

export const Bootstrap = Schema.Struct({
  setupToken: Token,
  email: Email,
  password: Password,
  name: Name,
  organization: Name,
})
export interface Bootstrap extends Schema.Schema.Type<typeof Bootstrap> {}
export const Login = Schema.Struct({ email: Email, password: Schema.String.check(Schema.isMaxLength(256)) })
export interface Login extends Schema.Schema.Type<typeof Login> {}
export const Register = Schema.Struct({ inviteToken: Token, email: Email, password: Password, name: Name })
export interface Register extends Schema.Schema.Type<typeof Register> {}
export const InviteCreate = Schema.Struct({ email: Email, role: Schema.Literals(["admin", "member"]) })
export interface InviteCreate extends Schema.Schema.Type<typeof InviteCreate> {}
export const KeyCreate = Schema.Struct({ name: Name, expiresAt: optional(Schema.Number) })
export interface KeyCreate extends Schema.Schema.Type<typeof KeyCreate> {}
export const PasswordChange = Schema.Struct({
  currentPassword: Schema.String.check(Schema.isMaxLength(256)),
  password: Password,
})
export interface PasswordChange extends Schema.Schema.Type<typeof PasswordChange> {}

export class Failure extends Schema.TaggedError<Failure>()("Console.Failure", {
  code: Schema.Literals(["unauthorized", "forbidden", "not_found", "conflict", "invalid"]),
  message: Schema.String,
}) {}
