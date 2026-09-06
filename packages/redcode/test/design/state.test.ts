import { describe, expect, test } from "bun:test"
import { DesignState } from "@/design/state"

describe("what a review remembers", () => {
  test("survives a round trip, chat and all", () => {
    const state: DesignState.Persisted = {
      id: "abc",
      sessionID: "ses_1",
      root: "/w/.redcode/designs/hero",
      name: "hero",
      token: "tok",
      revision: 4,
      ended: { by: "user", at: 100 },
      chat: [
        { role: "user", text: "make it blue", at: 1 },
        { role: "agent", text: "done", at: 2 },
      ],
    }
    expect(DesignState.parse(DesignState.serialize(state))).toEqual(state)
  })

  test("a corrupt or foreign sidecar is nothing, not a crash", () => {
    expect(DesignState.parse("{")).toBeUndefined()
    expect(DesignState.parse("[]")).toBeUndefined()
    expect(DesignState.parse(JSON.stringify({ id: "x" }))).toBeUndefined()
  })

  test("keeps what it recognises and drops what it does not", () => {
    const parsed = DesignState.parse(
      JSON.stringify({
        id: "abc",
        sessionID: "ses_1",
        root: "/w/a",
        token: "t",
        revision: -3,
        ended: { by: "someone", at: "soon" },
        chat: [{ role: "agent", text: "" }, { role: "user", text: "hi" }, "junk", { role: "x", text: "y", at: 5 }],
        extra: true,
      }),
    )!
    expect(parsed.name).toBe("a")
    expect(parsed.revision).toBe(1)
    expect(parsed.ended).toEqual({ by: "user", at: 0 })
    expect(parsed.chat).toEqual([
      { role: "user", text: "hi", at: 0 },
      { role: "user", text: "y", at: 5 },
    ])
    expect("extra" in parsed).toBe(false)
  })

  test("the index keeps only well-formed ids", () => {
    const index = DesignState.parseIndex(
      JSON.stringify({
        ok: { root: "/w/a", sessionID: "ses_1" },
        "../evil": { root: "/w/b", sessionID: "ses_1" },
        broken: { root: "" },
        list: [],
      }),
    )
    expect(Object.keys(index)).toEqual(["ok"])
    expect(DesignState.parseIndex("nope")).toEqual({})
  })
})
