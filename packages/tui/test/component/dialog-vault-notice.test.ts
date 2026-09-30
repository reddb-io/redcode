import { describe, expect, test } from "bun:test"
import { importedNotice, restrictedMessages, restrictedNotice, vaultNotice } from "../../src/component/dialog-vault"

describe("vault and restricted-content notices", () => {
  test("say what the vault replaced, without claiming earlier messages are safe", () => {
    const one = vaultNotice([{ name: "github-token-1", kind: "github-token" }])
    expect(one).toContain("1 secret was replaced by {vault:github-token-1}")
    expect(one).toContain("no longer part of the context sent to the model from now on")
    expect(one).toContain("can use a reference in commands without seeing its value")
    expect(one).toContain("can ask you for a secret it is missing")
    expect(one).toContain("in memory until the service restarts")
    expect(one).toContain("rotate anything real")
    const two = vaultNotice([
      { name: "github-token-1", kind: "github-token" },
      { name: "openai-key-1", kind: "openai-key" },
    ])
    expect(two).toContain("2 secrets were replaced by {vault:github-token-1}, {vault:openai-key-1}")
  })

  test("an import names the stored references and the skipped lines", () => {
    expect(importedNotice({ names: ["github-token", "db-password"], skipped: 0 })).toBe(
      "Imported 2 secrets: {vault:github-token}, {vault:db-password}",
    )
    expect(importedNotice({ names: ["api-key"], skipped: 1 })).toBe("Imported 1 secret: {vault:api-key} (skipped 1 line)")
    expect(importedNotice({ names: [], skipped: 3 })).toBe("Imported no secrets (skipped 3 lines)")
  })

  test("a flag says the message is still in the conversation and was already sent", () => {
    const notice = restrictedNotice("sensitive")
    expect(notice).toContain("Possible restricted content in this message")
    expect(notice).toContain("It is still in the current conversation until you remove it")
    expect(notice).toContain("has already been sent to your provider")
    expect(notice).toContain("rotate anything real")
    expect(notice).not.toContain("removed")
    expect(notice).not.toContain("safe")
  })

  test("a withheld message names the placeholder later requests carry, not a deletion", () => {
    const notice = restrictedNotice("withheld")
    expect(notice).toContain("[message withheld: restricted content]")
    expect(notice).toContain("stays in your local history")
    expect(notice).toContain("has already been sent to your provider")
    expect(notice).not.toContain("deleted")
  })

  test("reads the Session marker and ignores an unreadable one", () => {
    expect(restrictedMessages({ restricted: { msg_a: "sensitive", msg_b: "withheld" } })).toEqual({
      msg_a: "sensitive",
      msg_b: "withheld",
    })
    expect(restrictedMessages({ restricted: "yes" })).toEqual({})
    expect(restrictedMessages(undefined)).toEqual({})
  })
})
