import { describe, expect, test } from "bun:test"
import { DesignStates } from "@/design/states"

describe("state coverage", () => {
  test("all five present, in any element and any quoting", () => {
    const html = `<div data-state="loading"></div><section data-state='empty'/><p data-state=error></p>
      <ul data-state="populated"></ul><li data-state="edge"></li>`
    const c = DesignStates.states(html)
    expect(c.missing).toEqual([])
    expect([...c.present].sort()).toEqual(["edge", "empty", "error", "loading", "populated"])
  })

  test("duplicates count once and unknown values do not count", () => {
    const c = DesignStates.states(
      `<div data-state="empty"></div><div data-state="empty"></div><div data-state="busy"></div>`,
    )
    expect([...c.present]).toEqual(["empty"])
    expect(c.missing).toEqual(["loading", "error", "populated", "edge"])
  })

  test("nothing marked means everything missing, and a comment does not count", () => {
    expect(DesignStates.states(`<!-- data-state="error" --><h1>Hi</h1>`).missing).toEqual([...DesignStates.STATES])
  })

  test("questions track the missing states and leave other questions alone", () => {
    const before = ["what about mobile?", "state:error — old wording"]
    const once = DesignStates.syncQuestions(before, DesignStates.states(`<div data-state="populated"></div>`))
    expect(once[0]).toBe("what about mobile?")
    expect(once.filter((q) => q.startsWith("state:")).map((q) => q.split(" ")[0])).toEqual([
      "state:loading",
      "state:empty",
      "state:error",
      "state:edge",
    ])
    const later = DesignStates.syncQuestions(
      once,
      DesignStates.states(`<div data-state="populated"></div><div data-state="error"></div>`),
    )
    expect(later.some((q) => q.startsWith("state:error"))).toBe(false)
    expect(later.some((q) => q.startsWith("state:edge"))).toBe(true)
  })

  test("the report names what is missing, or says nothing", () => {
    expect(DesignStates.report({ present: new Set(DesignStates.STATES), missing: [] })).toBeUndefined()
    expect(DesignStates.report(DesignStates.states(`<div data-state="populated">`))).toContain(
      "States missing: loading, empty, error, edge",
    )
  })
})
