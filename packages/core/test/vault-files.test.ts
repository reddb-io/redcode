import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { Agent } from "@opencode/schema/agent"
import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { type Environment, makeFiles, makeLocalDriver } from "../src/environment/index.js"
import { EnvironmentUnavailable } from "../src/environment/unavailable.js"
import { Permission } from "../src/permission.js"
import { Tool } from "../src/tool.js"
import { Vault } from "../src/vault/vault.js"
import { VaultFiles } from "../src/vault/files.js"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(CrossSpawnSpawner.node))

// Assembled from parts so no secret scanner mistakes it for a real credential.
const secret = "sk" + "_test_" + "f".repeat(24)
const projectID = Project.ID.make("prj_vault_files")
const context = {
  sessionID: Session.ID.make("ses_vault_files"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_vault_files"),
  id: Tool.CallID.make("call_vault_files"),
  progress: () => Effect.void,
}
const git = Bun.which("git")

// An environment that cannot spawn, as where git cannot tell: the file name decides.
const noGit: Environment.Interface = {
  files: makeFiles(makeLocalDriver(EnvironmentUnavailable.spawner)),
  spawner: EnvironmentUnavailable.spawner,
}

const bound = () => {
  const vault = Vault.make()
  const name = Effect.runSync(vault.set({ projectID, name: "stripe-key", value: secret, origin: "user" }))
  return { vault, name, binding: Vault.bind(vault, projectID) }
}

describe("VaultFiles names and notices", () => {
  test("reads environment file names, never templates", () => {
    const cases: ReadonlyArray<readonly [string, boolean]> = [
      [".env", true],
      [".env.local", true],
      ["config/app.env", true],
      ["deploy/prod.env", true],
      [".env.example", false],
      [".env.sample", false],
      [".env.template", false],
      [".env.dist", false],
      [".env.default", false],
      ["app.env.defaults", false],
      [".envrc", false],
      ["environment.ts", false],
      ["src/.env/config.ts", false],
    ]
    expect(cases.map(([file]) => [file, VaultFiles.envNamed(file)])).toEqual(cases.map((item) => [...item]))
  })

  test("says which references stayed literal, and nothing for none", () => {
    expect(VaultFiles.notice([])).toBe("")
    expect(VaultFiles.notice(["a"])).toStartWith("{vault:a} was NOT resolved in this file")
    expect(VaultFiles.notice(["a", "b"])).toStartWith("{vault:a}, {vault:b} were NOT resolved in this file")
  })
})

describe("VaultFiles.mode", () => {
  it.effect("keeps every file plain outside a Session's tool execution", () =>
    Effect.gen(function* () {
      const mode = yield* VaultFiles.mode({
        environment: noGit,
        root: "/nonexistent",
        file: ".env",
        written: "KEY={vault:stripe-key}",
        current: secret,
      })
      expect(mode.secret).toBe(false)
      expect(mode.names).toEqual(["stripe-key"])
      expect(mode.clean(secret)).toBe(secret)
    }),
  )

  it.effect("does not ask where the file lives when the write carries no reference and the file no value", () =>
    Effect.gen(function* () {
      const fixture = bound()
      // An env-named file would be secret if its eligibility were checked; plain proves it was not.
      const mode = yield* VaultFiles.mode({
        environment: noGit,
        root: "/nonexistent",
        file: ".env",
        written: "PLAIN=1",
        current: "OTHER=2",
      }).pipe(Effect.provideService(Vault.Current, fixture.binding))
      expect(mode).toMatchObject({ secret: false, names: [] })
    }),
  )

  it.effect("decides by file name where git cannot tell, for a written reference or a stored value", () =>
    Effect.gen(function* () {
      const fixture = bound()
      const mode = (file: string, written: string, current: string) =>
        VaultFiles.mode({ environment: noGit, root: "/nonexistent", file, written, current }).pipe(
          Effect.provideService(Vault.Current, fixture.binding),
        )
      expect((yield* mode(".env", `KEY={vault:${fixture.name}}`, "")).secret).toBe(true)
      expect((yield* mode("src/config.ts", `KEY={vault:${fixture.name}}`, "")).secret).toBe(false)
      expect((yield* mode(".env.example", `KEY={vault:${fixture.name}}`, "")).secret).toBe(false)
      // A file that already holds a value is edited in its reference form even when the write names none.
      const holding = yield* mode(".env.local", "OTHER=1", `KEY=${secret}\n`)
      expect(holding.secret).toBe(true)
      expect(holding.clean(`KEY=${secret}\n`)).toBe(`KEY={vault:${fixture.name}}\n`)
    }),
  )

  const live = git ? it.live : it.live.skip
  live("lets git decide inside a repository, whatever the file is named", () =>
    Effect.gen(function* () {
      const fixture = bound()
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const environment: Environment.Interface = { files: makeFiles(makeLocalDriver(spawner)), spawner }
      const repo = yield* tmpdirScoped("opencode-vault-files-repo-")
      const outside = yield* tmpdirScoped("opencode-vault-files-plain-")
      yield* Effect.promise(async () => {
        Bun.spawnSync([git ?? "git", "init", "-q"], { cwd: repo.path, stdout: "ignore", stderr: "ignore" })
        await fs.writeFile(path.join(repo.path, ".gitignore"), ".env\nsecrets/\n")
      })
      const secretIn = (root: string, file: string) =>
        VaultFiles.mode({ environment, root, file, written: `KEY={vault:${fixture.name}}`, current: "" }).pipe(
          Effect.provideService(Vault.Current, fixture.binding),
          Effect.map((mode) => mode.secret),
        )
      expect(yield* secretIn(repo.path, ".env")).toBe(true)
      expect(yield* secretIn(repo.path, "secrets/token.txt")).toBe(true)
      // Inside a repository an env-named file that git does not ignore may be committed.
      expect(yield* secretIn(repo.path, "local.env")).toBe(false)
      expect(yield* secretIn(repo.path, "config.ts")).toBe(false)
      // Outside one the name decides.
      expect(yield* secretIn(outside.path, ".env")).toBe(true)
      expect(yield* secretIn(outside.path, "config.ts")).toBe(false)
    }),
  )
})

describe("VaultFiles.fill and cleaner", () => {
  it.effect("fills every reference, or fails naming the first unknown one without any value", () =>
    Effect.gen(function* () {
      const fixture = bound()
      const provide = <A, E>(effect: Effect.Effect<A, E>) =>
        effect.pipe(Effect.provideService(Vault.Current, fixture.binding))
      expect(yield* provide(VaultFiles.fill(`A={vault:${fixture.name}}\nB={vault:${fixture.name}}\n`))).toBe(
        `A=${secret}\nB=${secret}\n`,
      )
      expect(yield* provide(VaultFiles.fill("no references"))).toBe("no references")
      const unknown = yield* provide(VaultFiles.fill(`A={vault:${fixture.name}} B={vault:missing-1}`)).pipe(Effect.flip)
      expect(unknown.message).toBe(Vault.unknownReference("missing-1"))
      expect(unknown.message).not.toContain(secret)
      // Outside a Session's tool execution no reference resolves.
      const unbound = yield* VaultFiles.fill(`A={vault:${fixture.name}}`).pipe(Effect.flip)
      expect(unbound.message).toBe(Vault.unknownReference(fixture.name))
    }),
  )

  it.effect("cleans with the running call's vault, and changes nothing outside one", () =>
    Effect.gen(function* () {
      const fixture = bound()
      expect((yield* VaultFiles.cleaner)(`KEY=${secret}`)).toBe(`KEY=${secret}`)
      const clean = yield* VaultFiles.cleaner.pipe(Effect.provideService(Vault.Current, fixture.binding))
      expect(clean(`KEY=${secret}`)).toBe(`KEY={vault:${fixture.name}}`)
    }),
  )
})

describe("VaultFiles.approve", () => {
  const permissionWith = (overrides: Partial<Permission.Interface>) => {
    const asked: Permission.AssertInput[] = []
    const permission: Permission.Interface = {
      close: Effect.void,
      evaluate: () => Effect.succeed("ask"),
      explicit: () => Effect.succeed(false),
      ask: (input) => Effect.succeed({ id: input.id ?? Permission.ID.create(), effect: "ask" }),
      assert: (input) => Effect.sync(() => void asked.push(input)),
      decide: (input) => Effect.sync(() => asked.push(input)).pipe(Effect.as("always" as const)),
      reply: () => Effect.void,
      get: () => Effect.succeed(undefined),
      forSession: () => Effect.succeed([]),
      list: () => Effect.succeed([]),
      ...overrides,
    }
    return { asked, permission }
  }

  it.effect("asks once per secret and file, and remembers an always on the secret", () =>
    Effect.gen(function* () {
      const fixture = bound()
      const fake = permissionWith({})
      const approve = VaultFiles.approve({
        permission: fake.permission,
        context,
        resource: ".env",
        names: [fixture.name],
      }).pipe(Effect.provideService(Vault.Current, fixture.binding))
      yield* approve
      yield* approve
      expect(fake.asked).toHaveLength(1)
      expect(fake.asked[0]).toMatchObject({
        action: "vault",
        resources: [`${fixture.name}@file:.env`],
        metadata: { secrets: [fixture.name], destinations: ["file:.env"], file: ".env" },
      })
      expect((yield* fixture.vault.list(projectID))[0]?.hosts).toEqual(["file:.env"])
      expect(JSON.stringify(fake.asked)).not.toContain(secret)
    }),
  )

  it.effect("turns a decline with feedback and a refusal into failures the model reads", () =>
    Effect.gen(function* () {
      const fixture = bound()
      const approve = (permission: Permission.Interface) =>
        VaultFiles.approve({ permission, context, resource: ".env", names: [fixture.name] }).pipe(
          Effect.provideService(Vault.Current, fixture.binding),
          Effect.flip,
        )
      const corrected = permissionWith({
        decide: () => Effect.fail(new Permission.CorrectedError({ feedback: "use .env.local" })),
      })
      expect((yield* approve(corrected.permission)).message).toBe("The user declined: use .env.local")
      const blocked = permissionWith({
        decide: () =>
          Effect.fail(
            new Permission.BlockedError({ rules: [], permission: "vault", resources: ["stripe-key@file:.env"] }),
          ),
      })
      expect((yield* approve(blocked.permission)).message).toBe("Permission denied: vault")
      expect((yield* fixture.vault.list(projectID))[0]?.hosts).toBeUndefined()
    }),
  )
})
