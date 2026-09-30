import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Project } from "@opencode/schema/project"
import { UserPayload } from "@opencode/schema/session-inbox"
import { Skill } from "@opencode/schema/skill"
import { Redact } from "@opencode/util/redact"
import { Vault } from "../src/vault/vault.js"
import { VaultAdmission } from "../src/vault/admission.js"
import { testEffect } from "./lib/effect"

const it = testEffect(Vault.layer)

// Every fixture is assembled from parts so no secret scanner mistakes it for a real credential.
const token = "ghp" + "_" + "a".repeat(36)
const other = "ghp" + "_" + "b".repeat(36)
const special = "p@ss" + ".w0rd(1)+[x]$^|{y}\\z"
const checksum = "aB1".repeat(12)
const projectA = Project.ID.make("prj_vault_a")
const projectB = Project.ID.make("prj_vault_b")
const fake = (index: number) => "fake" + "-value-" + String(index).repeat(12)

describe("Vault", () => {
  it.effect("names a value once per project, with stable kind-numbered names", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const first = yield* vault.put({ projectID: projectA, kind: "github-token", value: token })
      const again = yield* vault.put({ projectID: projectA, kind: "github-token", value: token })
      const second = yield* vault.put({ projectID: projectA, kind: "github-token", value: other })
      expect([first, again, second]).toEqual(["github-token-1", "github-token-1", "github-token-2"])
      expect(yield* vault.resolve({ projectID: projectA, name: first })).toBe(token)
      expect((yield* vault.list(projectA)).map((entry) => [entry.name, entry.kind])).toEqual([
        ["github-token-1", "github-token"],
        ["github-token-2", "github-token"],
      ])
      expect(JSON.stringify(yield* vault.list(projectA))).not.toContain(token)
    }),
  )

  it.effect("keeps a secret of one project invisible to another", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const name = yield* vault.put({ projectID: projectA, kind: "github-token", value: token })
      expect(yield* vault.resolve({ projectID: projectB, name })).toBeUndefined()
      expect(yield* vault.list(projectB)).toEqual([])
      expect(yield* vault.scrub(projectB, `echo ${token}`)).toBe(`echo ${token}`)
      expect(yield* vault.forget({ projectID: projectB, name })).toBe(false)
      expect(yield* vault.resolve({ projectID: projectA, name })).toBe(token)
    }),
  )

  it.effect("scrubs every stored value, the longest first", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const short = "hunter" + "2hunter2"
      const long = `${short}-and-more`
      const shortName = yield* vault.put({ projectID: projectA, kind: "password", value: short })
      const longName = yield* vault.put({ projectID: projectA, kind: "password", value: long })
      expect(yield* vault.scrub(projectA, `a=${long} b=${short} c=${short}`)).toBe(
        `a={vault:${longName}} b={vault:${shortName}} c={vault:${shortName}}`,
      )
      expect(yield* vault.scrub(projectA, "nothing to hide")).toBe("nothing to hide")
    }),
  )

  it.effect("returns nothing for an unknown or forgotten name and never reuses a name", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      expect(yield* vault.resolve({ projectID: projectA, name: "github-token-7" })).toBeUndefined()
      const name = yield* vault.put({ projectID: projectA, kind: "github-token", value: token })
      expect(yield* vault.forget({ projectID: projectA, name })).toBe(true)
      expect(yield* vault.resolve({ projectID: projectA, name })).toBeUndefined()
      expect(yield* vault.put({ projectID: projectA, kind: "github-token", value: other })).toBe("github-token-2")
    }),
  )

  it.effect("reads references and resolves them only under a binding", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const name = yield* vault.put({ projectID: projectA, kind: "github-token", value: token })
      expect(vault.references(`use {vault:${name}} twice {vault:${name}} and {vault:api-key-2}`)).toEqual([
        name,
        "api-key-2",
      ])
      expect(yield* Vault.resolveAll([name])).toEqual({ missing: name })
      const bound = yield* Vault.resolveAll([name]).pipe(
        Effect.provideService(Vault.Current, Vault.bind(vault, projectA)),
      )
      expect("values" in bound ? bound.values.get(name) : undefined).toBe(token)
      const foreign = yield* Vault.resolveAll([name]).pipe(
        Effect.provideService(Vault.Current, Vault.bind(vault, projectB)),
      )
      expect(foreign).toEqual({ missing: name })
      expect(Vault.unknownReference("x-1")).toContain("Unknown vault reference {vault:x-1}")
    }),
  )

  it.effect("falls back to a generic kind, trims a long one, and skips a name another kind already holds", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      expect(yield* vault.put({ projectID: projectA, kind: "!!!", value: fake(1) })).toBe("secret-1")
      expect(yield* vault.put({ projectID: projectA, kind: "a-".repeat(30), value: fake(2) })).toBe(
        `${"a-".repeat(23)}a-1`,
      )
      expect(yield* vault.set({ projectID: projectA, name: "api-key-1", value: fake(3), origin: "user" })).toBe(
        "api-key-1",
      )
      expect(yield* vault.put({ projectID: projectA, kind: "api-key", value: fake(4) })).toBe("api-key-2")
      expect(yield* vault.resolve({ projectID: projectA, name: "api-key-1" })).toBe(fake(3))
      expect(JSON.stringify(yield* vault.list(projectA))).not.toContain("fake-value")
    }),
  )

  it.effect("adds the hosts of a value put again to the name that already holds it", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const name = yield* vault.put({ projectID: projectA, kind: "github-token", value: token })
      expect(yield* vault.put({ projectID: projectA, kind: "other", value: token, hosts: ["api.github.com"] })).toBe(
        name,
      )
      expect((yield* vault.list(projectA)).map((entry) => [entry.name, entry.hosts])).toEqual([
        [name, ["api.github.com"]],
      ])
    }),
  )

  it.effect("decides by origin whether a new value may take a name another value holds", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const set = (name: string, value: string, origin: "user" | "requested" | "captured", hosts: string[]) =>
        vault.set({ projectID: projectA, name, value, origin, hosts })
      // The user's own value under a name.
      expect(yield* set("deploy-key", fake(1), "user", ["a.example"])).toBe("deploy-key")
      // A request never replaces; a captured value replaces only another captured one.
      expect(yield* set("deploy-key", fake(2), "requested", [])).toBe("deploy-key-1")
      expect(yield* set("deploy-key", fake(3), "captured", [])).toBe("deploy-key-2")
      expect(yield* set("deploy-key-2", fake(4), "captured", [])).toBe("deploy-key-2")
      expect(yield* set("deploy-key-1", fake(5), "captured", [])).toBe("deploy-key-1-1")
      // The user replaces anything and keeps where the name may go; the same value only adds hosts.
      expect(yield* set("deploy-key", fake(6), "user", ["b.example"])).toBe("deploy-key")
      expect(yield* set("deploy-key", fake(6), "requested", ["c.example"])).toBe("deploy-key")
      // A name with nothing reference-safe in it takes a kind-numbered one.
      expect(yield* set("!!!", fake(7), "requested", [])).toBe("secret-1")
      expect(
        yield* vault.set({ projectID: projectA, name: "", value: fake(8), origin: "captured", kind: "Session Cookie" }),
      ).toBe("session-cookie-1")

      const resolved = yield* Effect.forEach(["deploy-key", "deploy-key-1", "deploy-key-2", "deploy-key-1-1"], (name) =>
        vault.resolve({ projectID: projectA, name }),
      )
      expect(resolved).toEqual([fake(6), fake(2), fake(4), fake(5)])
      const listed = yield* vault.list(projectA)
      expect(listed.find((entry) => entry.name === "deploy-key")?.hosts).toEqual(["a.example", "b.example", "c.example"])
      expect(JSON.stringify(listed)).not.toContain("fake-value")
    }),
  )

  it.effect("scrubs a value two names hold to the older name, and stops once both are forgotten", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      yield* vault.set({ projectID: projectA, name: "first", value: token, origin: "user" })
      yield* vault.set({ projectID: projectA, name: "second", value: token, origin: "user" })
      expect(yield* vault.scrub(projectA, token)).toBe("{vault:first}")
      expect(yield* vault.forget({ projectID: projectA, name: "first" })).toBe(true)
      expect(yield* vault.scrub(projectA, token)).toBe("{vault:second}")
      expect(yield* vault.forget({ projectID: projectA, name: "first" })).toBe(false)
      expect(yield* vault.forget({ projectID: projectA, name: "second" })).toBe(true)
      expect(yield* vault.scrub(projectA, token)).toBe(token)
      expect(yield* vault.list(projectA)).toEqual([])
    }),
  )

  it.effect("scrubs a value full of pattern characters literally", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      yield* vault.set({ projectID: projectA, name: "special", value: special, origin: "user" })
      const lookalike = special.replace(".", "X")
      expect(yield* vault.scrub(projectA, `a ${special} b ${lookalike}`)).toBe(`a {vault:special} b ${lookalike}`)
    }),
  )

  it.effect("allows destinations only for a name the project holds, and lists them sorted", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const name = yield* vault.set({ projectID: projectA, name: "sorted", value: token, origin: "user" })
      yield* vault.allow({ projectID: projectA, name, destination: "z.example" })
      yield* vault.allow({ projectID: projectA, name, destination: "a.example" })
      yield* vault.allow({ projectID: projectA, name: "missing", destination: "a.example" })
      yield* vault.allow({ projectID: projectB, name, destination: "evil.example" })
      expect((yield* vault.list(projectA)).map((entry) => [entry.name, entry.kind, entry.hosts])).toEqual([
        [name, "sorted", ["a.example", "z.example"]],
      ])
      expect(yield* vault.list(projectB)).toEqual([])
    }),
  )

  it.effect("resolves every name or reports the first missing one", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      yield* vault.set({ projectID: projectA, name: "a", value: fake(1), origin: "user" })
      yield* vault.set({ projectID: projectA, name: "b", value: fake(2), origin: "user" })
      const bound = <A>(effect: Effect.Effect<A>) =>
        effect.pipe(Effect.provideService(Vault.Current, Vault.bind(vault, projectA)))
      expect(yield* bound(Vault.resolveAll(["a", "zz", "b", "yy"]))).toEqual({ missing: "zz" })
      const all = yield* bound(Vault.resolveAll(["a", "b"]))
      expect("values" in all ? Array.from(all.values) : []).toEqual([
        ["a", fake(1)],
        ["b", fake(2)],
      ])
      const none = yield* Vault.resolveAll([])
      expect("values" in none ? none.values.size : -1).toBe(0)
    }),
  )

  it.effect("binds one project: capture stores each new high-confidence value once, bound to its hosts", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const binding = Vault.bind(vault, projectA)
      const output = [`token=${token}`, `again ${token} and ${other}`, `checksum=${checksum}`, `"password": "test"`]
      const captured = yield* binding.capture(output, ["api.github.com"])
      expect(captured.names).toEqual(["github-token-1", "github-token-2"])
      const shown = captured.clean(output.join("\n"))
      expect(shown).toBe(
        [
          "token={vault:github-token-1}",
          "again {vault:github-token-1} and {vault:github-token-2}",
          `checksum=${checksum}`,
          `"password": "test"`,
        ].join("\n"),
      )
      expect(yield* binding.hosts(["github-token-1", "missing"])).toEqual(
        new Map([
          ["github-token-1", ["api.github.com"]],
          ["missing", []],
        ]),
      )
      yield* binding.allow("github-token-2", "cmd:psql")
      expect((yield* binding.hosts(["github-token-2"])).get("github-token-2")).toEqual(["api.github.com", "cmd:psql"])
      expect(yield* binding.scrub(`x ${other}`)).toBe("x {vault:github-token-2}")
      expect((yield* binding.scrubber)(`y ${token}`)).toBe("y {vault:github-token-1}")
      expect(yield* binding.set({ name: "", value: fake(1), origin: "requested", kind: "db-password" })).toBe(
        "db-password-1",
      )
      expect(JSON.stringify(captured.names)).not.toContain(token)

      // Another project captures the same kind of value under its own names and never sees these.
      const foreign = Vault.bind(vault, projectB)
      expect((yield* foreign.capture([`use ${other}`])).names).toEqual(["github-token-1"])
      expect(yield* foreign.resolve("github-token-2")).toBeUndefined()
      expect(yield* foreign.resolve("db-password-1")).toBeUndefined()
      expect(yield* foreign.scrub(token)).toBe(token)
    }),
  )

  it.effect("captures nothing from output without a high-confidence secret", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const captured = yield* Vault.bind(vault, projectA).capture([`checksum=${checksum}`, "{vault:github-token-1}"])
      expect(captured.names).toEqual([])
      expect(captured.clean("unchanged")).toBe("unchanged")
      expect(yield* vault.list(projectA)).toEqual([])
    }),
  )

  it.effect("scrubs what fill wrote back to the reference, whatever the value and the context", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const fakes = [token, special, "line one\nline 'two'\n\tthree $x", "sénha-秘密-\u{1f511}-" + "q".repeat(8)]
      const names = yield* Effect.forEach(fakes, (value, index) =>
        vault.set({ projectID: projectA, name: `fake-${index}`, value, origin: "user" }),
      )
      const values = new Map(names.map((name, index) => [name, fakes[index]] as const))
      const contexts = [
        (ref: string) => ref,
        (ref: string) => `"${ref}"`,
        (ref: string) => `'${ref}'`,
        (ref: string) => `Authorization: Bearer ${ref}`,
        (ref: string) => JSON.stringify({ token: ref }),
        (ref: string) => `https://me:${ref}@api.example.com/?key=${ref}`,
        (ref: string) => `cat <<EOF\n${ref}\nEOF`,
        (ref: string) => `x${ref}y${ref}z`,
      ]
      const scrub = yield* vault.scrubber(projectA)
      const cases = names.flatMap((name, index) =>
        contexts.map((context) => ({ text: context(Vault.reference(name)), value: fakes[index] })),
      )
      cases.forEach((item) => {
        const filled = Vault.fill(item.text, values)
        expect(filled).toContain(item.value)
        expect(Vault.references(filled)).toEqual([])
        expect(scrub(filled)).toBe(item.text)
      })
    }),
  )
})

describe("Vault text helpers", () => {
  test("reads only well-formed references, each once", () => {
    expect(Vault.references("no references here")).toEqual([])
    expect(Vault.references("{vault:Upper} {vault:-dash} {vault:} {vault:ok-1} {vault:ok-1}")).toEqual(["ok-1"])
    expect(Vault.references(`{vault:${"a".repeat(64)}} {vault:${"b".repeat(65)}}`)).toEqual(["a".repeat(64)])
  })

  test("fills resolved references and leaves the rest as written", () => {
    const values = new Map([["k", fake(1)]])
    expect(Vault.fill("a {vault:k} b {vault:missing} c {vault:k}", values)).toBe(
      `a ${fake(1)} b {vault:missing} c ${fake(1)}`,
    )
    expect(
      Vault.fillRecord(
        {
          url: "https://x.example/?key={vault:k}",
          headers: { Authorization: "Bearer {vault:k}" },
          list: ["{vault:k}", "{vault:missing}"],
          count: 2,
        },
        values,
      ),
    ).toEqual({
      url: `https://x.example/?key=${fake(1)}`,
      headers: { Authorization: `Bearer ${fake(1)}` },
      list: [fake(1), "{vault:missing}"],
      count: 2,
    })
  })

  test("maps every string of plain JSON-like values and leaves other objects alone", () => {
    const upper = (text: string) => text.toUpperCase()
    const date = new Date(0)
    const map = new Map([["k", "v"]])
    const bare: Record<string, unknown> = Object.create(null)
    bare.inner = "bare"
    const mapped = Vault.scrubDeep({ a: ["x", { b: "y" }], n: 1, nil: null, flag: true, date, map, bare }, upper)
    expect(mapped).toEqual({ a: ["X", { b: "Y" }], n: 1, nil: null, flag: true, date, map, bare: { inner: "BARE" } })
    const record = Vault.scrubRecord({ command: "run", nested: { deep: ["z"] }, n: 3 }, upper)
    expect(record).toEqual({ command: "RUN", nested: { deep: ["Z"] }, n: 3 })
    expect(Vault.scrubDeep("top", upper)).toBe("TOP")
    expect(Vault.scrubDeep(undefined, upper)).toBeUndefined()
    expect(Vault.strings({ a: "x", b: ["y", { c: "z" }], d: 1, e: date })).toEqual(["x", "y", "z"])
  })

  test("stops descending past 32 levels of nesting", () => {
    const upper = (text: string) => text.toUpperCase()
    const nest = (levels: number): unknown => (levels === 0 ? "deep" : { next: nest(levels - 1) })
    expect(JSON.stringify(Vault.scrubDeep(nest(33), upper))).toContain("DEEP")
    expect(JSON.stringify(Vault.scrubDeep(nest(34), upper))).toContain("deep")
    expect(Vault.strings(nest(34))).toEqual([])
  })

  test("names the captured secrets in a note, and says nothing for none", () => {
    expect(Vault.captureNote([])).toBe("")
    expect(Vault.captureNote(["a-1", "b-1"])).toBe(
      "Stored 2 secrets from the output as {vault:a-1}, {vault:b-1}; use those references in later commands.",
    )
  })

  test("moves only high-confidence values of at least 8 characters that are not references", () => {
    const found = (text: string) => Vault.capturable(text).map((item) => [item.kind, item.value])
    expect(found(`push ${token}`)).toEqual([["github-token", token]])
    // High confidence, but too short to scrub from every later result without corrupting it.
    expect(found(`"password": "test"`)).toEqual([])
    expect(found(`postgres://app:${"x1".repeat(3)}x@db.example.com/app`)).toEqual([])
    expect(found(`postgres://app:${"x1".repeat(4)}@db.example.com/app`)).toEqual([["password", "x1".repeat(4)]])
    // Low confidence stays: it may be a hash the user meant.
    expect(Redact.findSecrets(`checksum=${checksum}`).map((item) => item.confidence)).toEqual(["low"])
    expect(found(`checksum=${checksum}`)).toEqual([])
    // A reference in a secret-named field is already vaulted.
    expect(found(`"password": "{vault:db-password-1}"`)).toEqual([])
  })
})

describe("VaultAdmission", () => {
  it.effect("moves high-confidence secrets out of a prompt and keeps everything else", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const checksum = "aB1".repeat(12)
      const text = `Push with GITHUB_TOKEN=${token} but keep checksum=${checksum} as is @build`
      const at = text.indexOf("@build")
      const payload = yield* VaultAdmission.protect(
        vault,
        projectA,
        UserPayload.make({
          text,
          agents: [{ name: "build", mention: { start: at, end: at + 6, text: "@build" } }],
          metadata: { source: "tui" },
        }),
      )
      expect(payload.text).toBe(
        `Push with GITHUB_TOKEN={vault:github-token-1} but keep checksum=${checksum} as is @build`,
      )
      const mention = payload.agents?.[0]?.mention
      expect(mention && payload.text.slice(mention.start, mention.end)).toBe("@build")
      expect(payload.metadata).toEqual({ source: "tui", vault: [{ name: "github-token-1", kind: "github-token" }] })
      expect(JSON.stringify(payload)).not.toContain(token)
      expect(yield* vault.resolve({ projectID: projectA, name: "github-token-1" })).toBe(token)
    }),
  )

  it.effect("drops a mention that covers a secret and protects text attachments", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const text = `see ${token}`
      const attachment = `API_KEY=${"abc" + "123def456"}\n`
      const payload = yield* VaultAdmission.protect(
        vault,
        projectA,
        UserPayload.make({
          text,
          files: [
            {
              data: Buffer.from(attachment).toString("base64"),
              mime: "text/plain",
              source: { type: "inline" },
              name: "notes.txt",
              mention: { start: 4, end: text.length, text: token },
            },
          ],
        }),
      )
      const file = payload.files?.[0]
      expect(file?.mention).toBeUndefined()
      expect(Buffer.from(file?.data ?? "", "base64").toString("utf8")).toBe("API_KEY={vault:api-key-1}\n")
      expect(payload.metadata?.vault).toEqual([
        { name: "github-token-1", kind: "github-token" },
        { name: "api-key-1", kind: "api-key" },
      ])
    }),
  )

  it.effect("returns a prompt without a high-confidence secret unchanged", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const payload = UserPayload.make({ text: `checksum=${"aB1".repeat(12)} and {vault:github-token-1}` })
      expect(yield* VaultAdmission.protect(vault, projectA, payload)).toBe(payload)
      expect(yield* vault.list(projectA)).toEqual([])
    }),
  )

  it.effect("keeps short high-confidence values in a prompt, which later scrubbing would corrupt", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const payload = UserPayload.make({ text: `use "password": "test" with postgres://app:abc@db.example.com/app` })
      expect(yield* VaultAdmission.protect(vault, projectA, payload)).toBe(payload)
      expect(yield* vault.list(projectA)).toEqual([])
    }),
  )

  it.effect("names a repeated secret once, keeps mentions before it and shifts skill mentions after it", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const text = `@plan read ${token} and ${token} for /deploy`
      const at = text.indexOf("/deploy")
      const before = { start: 0, end: 5, text: "@plan" }
      const image = {
        data: Buffer.from(`pixels ${token}`).toString("base64"),
        mime: "image/png",
        source: { type: "inline" as const },
      }
      const notes = {
        data: Buffer.from("nothing secret\n").toString("base64"),
        mime: "text/plain",
        source: { type: "inline" as const },
        mention: { start: at, end: at + 7, text: "/deploy" },
      }
      const payload = yield* VaultAdmission.protect(
        vault,
        projectA,
        UserPayload.make({
          text,
          files: [image, notes],
          agents: [{ name: "plan", mention: before }],
          skills: [
            {
              id: Skill.ID.make("deploy"),
              name: Skill.Name.make("deploy"),
              mention: { start: at, end: at + 7, text: "/deploy" },
            },
          ],
        }),
      )
      expect(payload.text).toBe("@plan read {vault:github-token-1} and {vault:github-token-1} for /deploy")
      expect(payload.agents?.[0]?.mention).toEqual(before)
      const skill = payload.skills?.[0]?.mention
      expect(skill && payload.text.slice(skill.start, skill.end)).toBe("/deploy")
      const file = payload.files?.[1]?.mention
      expect(file && payload.text.slice(file.start, file.end)).toBe("/deploy")
      // Only text attachments are scanned: an image keeps its bytes.
      expect(payload.files?.[0]?.data).toBe(image.data)
      expect(payload.files?.[1]?.data).toBe(notes.data)
      expect(payload.metadata).toEqual({ vault: [{ name: "github-token-1", kind: "github-token" }] })
      expect(JSON.stringify(payload)).not.toContain(token)
    }),
  )

  it.effect("moves a secret found only in an attachment and leaves the text and its mentions alone", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      const text = "see @notes"
      const mention = { start: 4, end: 10, text: "@notes" }
      const payload = yield* VaultAdmission.protect(
        vault,
        projectA,
        UserPayload.make({
          text,
          files: [
            {
              data: Buffer.from(`GITHUB_TOKEN=${token}\n`).toString("base64"),
              mime: "text/plain",
              source: { type: "inline" },
              mention,
            },
          ],
          agents: [{ name: "notes", mention }],
        }),
      )
      expect(payload.text).toBe(text)
      expect(payload.files?.[0]?.mention).toEqual(mention)
      expect(payload.agents?.[0]?.mention).toEqual(mention)
      expect(Buffer.from(payload.files?.[0]?.data ?? "", "base64").toString("utf8")).toBe(
        "GITHUB_TOKEN={vault:github-token-1}\n",
      )
      expect(payload.metadata).toEqual({ vault: [{ name: "github-token-1", kind: "github-token" }] })
    }),
  )

  it.effect("protects plain text, per project", () =>
    Effect.gen(function* () {
      const vault = yield* Vault.Service
      expect(yield* VaultAdmission.protectText(vault, projectA, `focus on ${token}, not ${other}`)).toBe(
        "focus on {vault:github-token-1}, not {vault:github-token-2}",
      )
      expect(yield* VaultAdmission.protectText(vault, projectA, "nothing here")).toBe("nothing here")
      expect(yield* VaultAdmission.protectText(vault, projectB, `only ${other}`)).toBe("only {vault:github-token-1}")
      expect(yield* vault.resolve({ projectID: projectB, name: "github-token-1" })).toBe(other)
      expect(yield* vault.resolve({ projectID: projectA, name: "github-token-1" })).toBe(token)
      expect(yield* vault.resolve({ projectID: projectB, name: "github-token-2" })).toBeUndefined()
    }),
  )
})
