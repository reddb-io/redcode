import { describe, expect, test } from "bun:test"
import { DesignKinds } from "@/design/kinds"

const ids = (kind: DesignKinds.Kind, html: string) => DesignKinds.check(kind, html).map((f) => f.id)

describe("kinds", () => {
  test("screen has no checks of its own", () => {
    expect(ids("screen", `<h1>anything</h1>`)).toEqual([])
  })

  test("a flow needs more than one step", () => {
    expect(ids("flow", `<div data-step="1"></div>`)).toEqual(["flow-single-step"])
    expect(ids("flow", `<div data-step="1"></div><div data-step="2"></div>`)).toEqual([])
  })

  test("a comparison needs more than one option", () => {
    expect(ids("comparison", `<div data-option="a"></div>`)).toEqual(["comparison-single-option"])
    expect(ids("comparison", `<div data-option="a"></div><div data-option="b"></div>`)).toEqual([])
  })

  test("a deck: slides, themes, and rhythm", () => {
    expect(ids("deck", `<div>no slides</div>`)).toEqual(["deck-no-slides"])
    expect(ids("deck", `<section class="slide"></section><section class="slide dark"></section>`)).toEqual([
      "slide-theme-missing",
    ])
    expect(
      ids(
        "deck",
        `<section class="slide light"></section><section class="slide hero light"></section><section class="slide light"></section>`,
      ),
    ).toEqual(["slide-rhythm"])
    expect(
      ids(
        "deck",
        `<section class="slide light"></section><section class="slide dark"></section><section class="slide hero light"></section>`,
      ),
    ).toEqual([])
  })

  test("isKind", () => {
    expect(DesignKinds.isKind("deck")).toBe(true)
    expect(DesignKinds.isKind("poster")).toBe(false)
  })
})
