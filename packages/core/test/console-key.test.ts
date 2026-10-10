import { expect, setSystemTime } from "bun:test"
import { Console } from "@opencode/core/console"
import { Database } from "@opencode/core/database/database"
import { Global } from "@opencode/util/global"
import { Effect, Layer } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(
  Console.layer({ setupToken: "setup" }).pipe(
    Layer.provide(Database.layer()),
    Layer.provide(Layer.succeed(Global.Service, Global.make())),
  ),
)

it.live("workspace key authentication observes expiry, revocation and member removal", () =>
  Effect.gen(function* () {
    const console = yield* Console.Service
    const owner = yield* console.bootstrap({
      setupToken: "setup",
      name: "Owner",
      email: "owner@example.test",
      password: "Console-password-test",
      organization: "Test",
    })
    const org = (yield* console.organizations(owner.token))[0].id
    const workspace = (yield* console.workspaces(owner.token, org))[0].id
    const expiresAt = Date.now() + 60_000
    const issued = yield* console.createKey(owner.token, workspace, { name: "Expires", expiresAt })
    expect(yield* console.authenticateKey(issued.token)).toEqual({
      organizationID: org,
      workspaceID: workspace,
      accountID: owner.account.id,
      keyID: issued.key.id,
    })
    setSystemTime(new Date(expiresAt + 1))
    expect((yield* console.authenticateKey(issued.token).pipe(Effect.flip)).code).toBe("unauthorized")
    setSystemTime()
    yield* console.revokeKey(owner.token, workspace, issued.key.id)
    expect((yield* console.authenticateKey(issued.token).pipe(Effect.flip)).code).toBe("unauthorized")
    const invite = yield* console.createInvite(owner.token, org, { email: "member@example.test", role: "member" })
    const member = yield* console.register({
      inviteToken: invite.token,
      email: "member@example.test",
      name: "Member",
      password: "Console-password-test",
    })
    const key = yield* console.createKey(member.token, workspace, { name: "Member" })
    expect((yield* console.authenticateKey(key.token)).accountID).toBe(member.account.id)
    yield* console.removeMember(owner.token, org, member.account.id)
    expect((yield* console.authenticateKey(key.token).pipe(Effect.flip)).code).toBe("unauthorized")
  }).pipe(Effect.ensuring(Effect.sync(() => setSystemTime()))),
)
