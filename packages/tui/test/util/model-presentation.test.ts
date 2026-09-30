import { describe, expect, test } from "bun:test"
import { catalogUpdateMessage, offerDetails, offerPrice } from "../../src/util/model-presentation"

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

describe("offerDetails", () => {
  const offer = {
    id: "zen/jev-1.13",
    provider: { id: "zen", name: "OpenCode Zen" },
    via: [],
    available: true,
    price: { input: 0.3, output: 1.25 },
    free: false,
  }

  test("reads price, availability and whether the offer serves now", () => {
    expect(offerDetails({ offer, lead: true, model: {} })).toBe("$0.3/$1.25 per 1M · available · serving now")
  })

  test("names an unavailable offer that cannot be pinned", () => {
    expect(offerDetails({ offer: { ...offer, available: false, price: undefined }, lead: false })).toBe(
      "unavailable · cannot be pinned",
    )
  })

  test("prices free offers as free and unknown halves as unknown", () => {
    expect(offerPrice({ ...offer, free: true })).toBe("free")
    expect(offerPrice({ free: false, price: { output: 15 } })).toBe("?/$15 per 1M")
  })
})
