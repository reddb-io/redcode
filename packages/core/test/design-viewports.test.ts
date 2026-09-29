import { describe, expect, test } from "bun:test"
import { viewports } from "@opencode/core/design/ui/viewports"
import { DesignViewports } from "@opencode/core/design/viewports"

describe("viewports", () => {
  const cases: Array<[string, Parameters<typeof viewports>, ReturnType<typeof viewports>]> = [
    [
      "web defaults to 390, 768 and 1440",
      ["web", undefined],
      [
        { width: 390, height: 900 },
        { width: 768, height: 900 },
        { width: 1440, height: 900 },
      ],
    ],
    ["a document without a target is web", [undefined, undefined], viewports("web", undefined)],
    [
      "web follows configured breakpoints, sorted and without repeats",
      ["web", undefined, { breakpoints: [1280, 360, 1280] }],
      [
        { width: 360, height: 900 },
        { width: 1280, height: 900 },
      ],
    ],
    [
      "empty breakpoints fall back to the defaults",
      ["web", undefined, { breakpoints: [] }],
      viewports("web", undefined),
    ],
    ["web ignores a platform", ["web", "ios"], viewports("web", undefined)],
    ["an iOS app is one iPhone", ["app", "ios"], [{ width: 393, height: 852, device: "ios" }]],
    ["an Android app is one Android phone", ["app", "android"], [{ width: 412, height: 915, device: "android" }]],
    [
      "an app without a platform is both phones",
      ["app", undefined],
      [
        { width: 393, height: 852, device: "ios" },
        { width: 412, height: 915, device: "android" },
      ],
    ],
    [
      "an app ignores web breakpoints",
      ["app", "ios", { breakpoints: [1000] }],
      [{ width: 393, height: 852, device: "ios" }],
    ],
    ["a presentation is one 16:9 slide", ["presentation", undefined], [{ width: 1920, height: 1080 }]],
  ]
  test.each(cases)("%s", (_name, input, expected) => {
    expect(viewports(...input)).toEqual(expected)
  })

  test("survives serialization into the review page", () => {
    const serialized = new Function(`return (${viewports.toString()})`)() as typeof viewports
    expect(serialized("app", undefined)).toEqual(viewports("app", undefined))
    expect(serialized("web", undefined, { breakpoints: [500] })).toEqual([{ width: 500, height: 900 }])
  })

  test("core reads the document's target with the configured breakpoints", () => {
    expect(DesignViewports.of({ target: "web" }, { breakpoints: [600] })).toEqual([{ width: 600, height: 900 }])
    expect(DesignViewports.of({}, undefined)).toEqual(viewports("web", undefined))
    expect(DesignViewports.of({ target: "app", platform: "android" }, { breakpoints: [600] })).toEqual([
      { width: 412, height: 915, device: "android" },
    ])
  })
})
