import { describe, expect, test } from "bun:test"
import {
  adopt,
  arrange,
  clampRatio,
  companions,
  move,
  pick,
  resize,
  restore,
  select,
  shown,
  toggleExpanded,
  toggleMaximized,
  WORKBENCH_INITIAL,
  WORKBENCH_RATIO,
  type WorkbenchGroup,
} from "./workbench-model"

const DOCK = "terminal:main"
const home = (key: string): WorkbenchGroup => (key === DOCK ? "bottom" : "top")

describe("arrange", () => {
  test("side tabs start on top and the dock below", () => {
    const groups = arrange(["review:changes", "context:main", DOCK], WORKBENCH_INITIAL, home)

    expect(groups).toEqual({ top: ["review:changes", "context:main"], bottom: [DOCK] })
  })

  test("placed keys keep strip order inside their group", () => {
    const state = move(WORKBENCH_INITIAL, ["file://a.ts", "file://b.ts"], "bottom", home)
    const groups = arrange(["review:changes", "file://a.ts", DOCK, "file://b.ts"], state, home)

    expect(groups).toEqual({ top: ["review:changes"], bottom: ["file://a.ts", DOCK, "file://b.ts"] })
  })
})

describe("move", () => {
  test("selects the moved tab in its new group and restores a maximized group", () => {
    const state = move(toggleMaximized(WORKBENCH_INITIAL, "top"), ["review:changes"], "bottom", home)

    expect(state.placed).toEqual({ "review:changes": "bottom" })
    expect(state.bottom).toBe("review:changes")
    expect(state.maximized).toBeUndefined()
  })

  test("moving a key back home drops its placement", () => {
    const down = move(WORKBENCH_INITIAL, ["review:changes"], "bottom", home)
    const up = move(down, ["review:changes"], "top", home)

    expect(up.placed).toEqual({})
    expect(up.top).toBe("review:changes")
  })

  test("the dock can move to the top group", () => {
    const state = move(WORKBENCH_INITIAL, [DOCK], "top", home)

    expect(arrange(["review:changes", DOCK], state, home)).toEqual({ top: ["review:changes", DOCK], bottom: [] })
  })

  test("an empty move changes nothing", () => {
    expect(move(WORKBENCH_INITIAL, [], "bottom", home)).toBe(WORKBENCH_INITIAL)
  })
})

describe("companions", () => {
  test("tabs sharing a render move together", () => {
    const entries = [
      { key: "browser:a", group: "browser" },
      { key: "review:changes" },
      { key: "browser:b", group: "browser" },
    ]

    expect(companions(entries, "browser:b")).toEqual(["browser:a", "browser:b"])
    expect(companions(entries, "review:changes")).toEqual(["review:changes"])
  })
})

describe("pick", () => {
  test("keeps the stored selection while the group lists it", () => {
    expect(pick(["a", "b"], "b", ["a"])).toBe("b")
  })

  test("falls back to the first fallback the group lists", () => {
    expect(pick(["a", "b"], "gone", ["x", "b", "a"])).toBe("b")
    expect(pick(["a"], undefined, ["x"])).toBeUndefined()
  })
})

describe("shown", () => {
  test("both groups split the column", () => {
    expect(shown({ top: true, bottom: true })).toEqual({ top: true, bottom: true, split: true })
  })

  test("a maximized group hides the other", () => {
    expect(shown({ top: true, bottom: true }, "bottom")).toEqual({ top: false, bottom: true, split: false })
  })

  test("maximizing an empty group keeps the other on screen", () => {
    expect(shown({ top: true, bottom: false }, "bottom")).toEqual({ top: true, bottom: false, split: false })
  })
})

describe("restore", () => {
  test("undoes full width before a maximized group", () => {
    const state = toggleExpanded(toggleMaximized(WORKBENCH_INITIAL, "top"))
    const once = restore(state)

    expect(once.expanded).toBe(false)
    expect(once.maximized).toBe("top")
    expect(restore(once).maximized).toBeUndefined()
    expect(restore(WORKBENCH_INITIAL)).toBe(WORKBENCH_INITIAL)
  })

  test("the same control toggles maximize back", () => {
    expect(toggleMaximized(toggleMaximized(WORKBENCH_INITIAL, "bottom"), "bottom").maximized).toBeUndefined()
  })
})

describe("resize", () => {
  test("clamps the divider to the ratio bounds", () => {
    expect(resize(WORKBENCH_INITIAL, 0.01).ratio).toBe(WORKBENCH_RATIO.min)
    expect(resize(WORKBENCH_INITIAL, 0.99).ratio).toBe(WORKBENCH_RATIO.max)
  })

  test("keeps the minimum group height in a short column", () => {
    expect(clampRatio(0.1, 400)).toBe(0.3)
    expect(clampRatio(0.9, 400)).toBe(0.7)
    expect(clampRatio(0.9, 200)).toBe(0.5)
  })
})

describe("select and adopt", () => {
  test("select stores a group's selection", () => {
    expect(select(WORKBENCH_INITIAL, "bottom", DOCK).bottom).toBe(DOCK)
    expect(select(WORKBENCH_INITIAL, "top", "a").bottom).toBeUndefined()
  })

  test("a tab opened from a group's launcher lands in that group", () => {
    const state = adopt(WORKBENCH_INITIAL, {
      before: ["review:changes"],
      after: ["review:changes", "file://a.ts"],
      target: "bottom",
      home,
    })

    expect(state.placed).toEqual({ "file://a.ts": "bottom" })
    expect(state.bottom).toBe("file://a.ts")
  })
})
