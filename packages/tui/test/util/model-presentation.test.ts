import { describe, expect, test } from "bun:test"
import { catalogUpdateMessage } from "../../src/util/model-presentation"

describe("catalogUpdateMessage", () => {
  test("counts the models a router catalog refresh added, removed and renamed", () => {
    expect(catalogUpdateMessage({ name: "RedRouter", added: 2, removed: 1, renamed: 0 })).toBe(
      "RedRouter catalog updated: +2/−1 models",
    )
    expect(catalogUpdateMessage({ name: "RedRouter", added: 0, removed: 0, renamed: 3 })).toBe(
      "RedRouter catalog updated: +0/−0 models, 3 renamed",
    )
  })

  test("stays quiet when only limits or modes changed", () => {
    expect(catalogUpdateMessage({ name: "RedRouter", added: 0, removed: 0, renamed: 0 })).toBeUndefined()
  })
})
