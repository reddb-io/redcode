import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Project } from "@opencode/schema/project"
import { Vault } from "../src/vault/vault.js"
import { VaultCapture } from "../src/vault/capture.js"
import { VaultDotenv } from "../src/vault/dotenv.js"

// Every fixture is assembled from parts so no secret scanner mistakes it for a real credential.
const jwt = ["eyJ" + "hbGciOiJIUzI1NiJ9", "eyJ" + "zdWIiOiIxMjM0NTY3ODkwIn0", "c2lnbmF0dXJl" + "LXBhcnQ"].join(".")
const opaque = "op" + "aq" + "ue-" + "7f3a9c2e1b"
const projectID = Project.ID.make("prj_vault_capture")

const login = JSON.stringify({ token: jwt, session: opaque, user: { name: "me" } })

describe("Vault capture", () => {
  test("stores a JWT from a login response and hands back only its reference", async () => {
    const vault = Vault.make()
    const binding = Vault.bind(vault, projectID)
    const captured = await Effect.runPromise(binding.capture([login], ["api.example.com"]))
    expect(captured.names).toEqual(["jwt-1"])
    const shown = captured.clean(login)
    expect(shown).toBe(JSON.stringify({ token: "{vault:jwt-1}", session: opaque, user: { name: "me" } }))
    expect(Vault.captureNote(captured.names)).toBe(
      "Stored 1 secret from the output as {vault:jwt-1}; use that reference in later commands.",
    )
    expect(await Effect.runPromise(binding.resolve("jwt-1"))).toBe(jwt)
    // The host the response came from may receive the token back without asking.
    expect(await Effect.runPromise(binding.hosts(["jwt-1"]))).toEqual(new Map([["jwt-1", ["api.example.com"]]]))
  })

  test("never captures or replaces a value twice", async () => {
    const vault = Vault.make()
    const binding = Vault.bind(vault, projectID)
    const first = await Effect.runPromise(binding.capture([login]))
    const shown = first.clean(login)
    const again = await Effect.runPromise(binding.capture([shown, login]))
    expect(again.names).toEqual([])
    expect(again.clean(shown)).toBe(shown)
    expect(again.clean(again.clean(login))).toBe(shown)
    expect(await Effect.runPromise(vault.list(projectID))).toHaveLength(1)
  })

  test("replaces a short stored value in one pass, never inside a reference it just wrote", async () => {
    const vault = Vault.make()
    // `vault:pa` is part of the reference `{vault:password}`, which a second pass would break.
    await Effect.runPromise(vault.set({ projectID, name: "short", value: "vault:pa", origin: "user" }))
    await Effect.runPromise(vault.set({ projectID, name: "password", value: "hunter" + "2hunter2", origin: "user" }))
    const text = await Effect.runPromise(vault.scrub(projectID, `a=vault:pa b=${"hunter" + "2hunter2"}`))
    expect(text).toBe("a={vault:short} b={vault:password}")
  })

  test("selects an opaque token by JSON path, by pattern and as the whole output", async () => {
    expect(await Effect.runPromise(VaultCapture.select(login, "json:$.session"))).toEqual({ value: opaque })
    expect(await Effect.runPromise(VaultCapture.select(login, "json:$.user.name"))).toEqual({ value: "me" })
    expect(await Effect.runPromise(VaultCapture.select(`session=${opaque}\n`, "regex:session=(\\S+)"))).toEqual({
      value: opaque,
    })
    expect(await Effect.runPromise(VaultCapture.select(`  ${opaque}\n`, "stdout"))).toEqual({ value: opaque })
  })

  test("says why nothing was selected without quoting the output", async () => {
    const missing = await Effect.runPromise(VaultCapture.select(login, "json:$.data.token"))
    expect(missing).toEqual({
      failure: "$.data is not in the output; $ holds an object with keys token, session, user",
    })
    expect(await Effect.runPromise(VaultCapture.select(login, "json:$.user"))).toEqual({
      failure: "$.user selects an object with keys name, not a string",
    })
    expect(await Effect.runPromise(VaultCapture.select(opaque, "json:$.x"))).toEqual({
      failure: "the output is not JSON",
    })
    expect(await Effect.runPromise(VaultCapture.select(opaque, "regex:session"))).toEqual({
      failure: "the pattern did not match the output",
    })
    expect(await Effect.runPromise(VaultCapture.select(`session=${opaque}`, "regex:session=\\S+"))).toEqual({
      failure: "the pattern needs one capture group around the secret",
    })
    expect(JSON.stringify(missing)).not.toContain(jwt)
  })

  test("a named capture replaces its own earlier value but never a secret the user gave", async () => {
    const vault = Vault.make()
    const binding = Vault.bind(vault, projectID)
    const user = await Effect.runPromise(vault.set({ projectID, name: "api-token", value: opaque, origin: "user" }))
    const captured = await Effect.runPromise(binding.set({ name: "api-token", value: jwt, origin: "captured" }))
    expect([user, captured]).toEqual(["api-token", "api-token-1"])
    const renewed = await Effect.runPromise(
      binding.set({ name: "api-token-1", value: "re" + opaque, origin: "captured" }),
    )
    expect(renewed).toBe("api-token-1")
    expect(await Effect.runPromise(binding.resolve("api-token"))).toBe(opaque)
    expect(await Effect.runPromise(binding.resolve("api-token-1"))).toBe("re" + opaque)
    expect(JSON.stringify(await Effect.runPromise(vault.list(projectID)))).not.toContain(opaque)
  })
})

describe("VaultDotenv", () => {
  test("reads NAME=value lines and counts the rest", () => {
    const parsed = VaultDotenv.parse(
      [
        "# comment",
        "",
        `GITHUB_TOKEN=${opaque}`,
        `export DB_PASSWORD="two words"`,
        `SINGLE='it is' # trailing`,
        `INLINE=value # comment`,
        "EMPTY=",
        "not a line",
      ].join("\r\n"),
    )
    expect(parsed).toEqual({
      entries: [
        { name: "GITHUB_TOKEN", value: opaque },
        { name: "DB_PASSWORD", value: "two words" },
        { name: "SINGLE", value: "it is" },
        { name: "INLINE", value: "value" },
      ],
      skipped: 2,
    })
    expect(Vault.sanitize("GITHUB_TOKEN")).toBe("github-token")
  })
})
