import { describe, expect, test } from "bun:test"
import { Router } from "../src/router"

describe("Router.route", () => {
  test("flat and nested ids parse to the same upstream and model at any depth", () => {
    const flat = Router.route("opencode-zen/jev-1.13")
    const two = Router.route("red-router/opencode-zen/jev-1.13")
    const three = Router.route("red-router/red-router/opencode-zen/jev-1.13")
    expect(flat).toEqual({ hops: [], provider: "opencode-zen", model: "jev-1.13" })
    expect(two).toEqual({ hops: ["red-router"], provider: "opencode-zen", model: "jev-1.13" })
    expect(three).toEqual({ hops: ["red-router", "red-router"], provider: "opencode-zen", model: "jev-1.13" })
    expect(Router.route("9router/red-router/opencode-go/jev-1.13")).toEqual({
      hops: ["9router", "red-router"],
      provider: "opencode-go",
      model: "jev-1.13",
    })
  })

  test("keeps the slashes of the upstream's own model id and handles ids without a provider", () => {
    expect(Router.route("openrouter/typesafe/jev-1.13")).toEqual({
      hops: [],
      provider: "openrouter",
      model: "typesafe/jev-1.13",
    })
    expect(Router.route("red-router/openrouter/typesafe/jev-1.13")).toEqual({
      hops: ["red-router"],
      provider: "openrouter",
      model: "typesafe/jev-1.13",
    })
    expect(Router.route("jev-1.13.0")).toEqual({ hops: [], provider: undefined, model: "jev-1.13.0" })
    expect(Router.route("red-router/jev-1.13.0")).toEqual({ hops: ["red-router"], provider: undefined, model: "jev-1.13.0" })
  })

  test("names routes: hops joined by », the model kept behind a dot", () => {
    expect(Router.hopName("red-router")).toBe("RedRouter")
    expect(Router.hopName("9router")).toBe("9Router")
    expect(Router.hopName("toString")).toBe("toString")
    expect(
      Router.routeName({ routers: ["RedRouter"], upstream: "OpenCode Zen (via OpenCode Go)", model: "JEV 1.13" }),
    ).toBe("RedRouter » OpenCode Zen (via OpenCode Go) · JEV 1.13")
    expect(
      Router.routeName({
        routers: ["RedRouter", "RedRouter"],
        upstream: "OpenCode Zen (via OpenCode Go)",
        model: "JEV 1.13",
      }),
    ).toBe("RedRouter » RedRouter » OpenCode Zen (via OpenCode Go) · JEV 1.13")
    expect(Router.routeName({ routers: ["RedRouter"], model: "jev-1.13.0" })).toBe("RedRouter · jev-1.13.0")
  })
})

describe("Router.routeOf", () => {
  test("never reads a provider from a flat model id: the offer that serves it by policy decides", () => {
    const jev = {
      id: "typesafe/jev-1.13",
      flat: true,
      offers: [
        { id: "red-router/red-router/opencode-go/typesafe/jev-1.13", available: false },
        { id: "openrouter/typesafe/jev-1.13", available: true },
      ],
    }
    // The first available offer serves it; `typesafe` is not a provider.
    expect(Router.routeOf(jev)).toEqual({ hops: [], provider: "openrouter", model: "typesafe/jev-1.13" })
    expect(Router.leadOffer(jev)?.id).toBe("openrouter/typesafe/jev-1.13")
    expect(Router.routeOf({ ...jev, offers: [{ id: "red-router/opencode-go/typesafe/jev-1.13" }] })).toEqual({
      hops: ["red-router"],
      provider: "opencode-go",
      model: "typesafe/jev-1.13",
    })
    expect(Router.routeOf({ id: "typesafe/jev-1.13", flat: true })).toEqual({
      hops: [],
      provider: undefined,
      model: "typesafe/jev-1.13",
    })
    // A prefixed id parses as it always did.
    expect(Router.routeOf({ id: "typesafe/jev-1.13" })).toEqual(Router.route("typesafe/jev-1.13"))
  })
})
