import { describe, expect, test } from "bun:test"
import { nineRouterConnectionProblem, normalizeNineRouterURL } from "../../src/util/nine-router"

describe("normalizeNineRouterURL", () => {
  test("adds http when the scheme is missing", () => {
    expect(normalizeNineRouterURL("localhost:20128")).toBe("http://localhost:20128/v1")
    expect(normalizeNineRouterURL(" 127.0.0.1:20128 ")).toBe("http://127.0.0.1:20128/v1")
  })

  test("strips a trailing /models", () => {
    expect(normalizeNineRouterURL("http://127.0.0.1:20128/v1/models/")).toBe("http://127.0.0.1:20128/v1")
    expect(normalizeNineRouterURL("https://router.example/api/v1/models")).toBe("https://router.example/api/v1")
  })

  test("adds /v1 to a bare root and keeps other paths", () => {
    expect(normalizeNineRouterURL("http://127.0.0.1:20128")).toBe("http://127.0.0.1:20128/v1")
    expect(normalizeNineRouterURL("http://127.0.0.1:20128/")).toBe("http://127.0.0.1:20128/v1")
    expect(normalizeNineRouterURL("http://router.example/api///")).toBe("http://router.example/api")
  })

  test("rejects non-HTTP URLs and URLs with credentials, query or fragment", () => {
    for (const value of [
      "",
      "http://",
      "ftp://router/v1",
      "file:///tmp/key",
      "http://user:pass@router/v1",
      "http://router/v1?key=secret",
      "http://router/v1#fragment",
    ]) {
      expect(normalizeNineRouterURL(value)).toBeUndefined()
    }
  })
})

describe("nineRouterConnectionProblem", () => {
  const providers = [{ id: "9router", models: { combo: {} } }]

  test("accepts the saved connection when URLs differ only in normalization", () => {
    expect(
      nineRouterConnectionProblem({
        baseURL: "http://127.0.0.1:20128/v1",
        options: { baseURL: "127.0.0.1:20128/v1/" },
        providers,
      }),
    ).toBeUndefined()
  })

  test("reports an apiKey override", () => {
    expect(
      nineRouterConnectionProblem({
        baseURL: "http://127.0.0.1:20128/v1",
        options: { baseURL: "http://127.0.0.1:20128/v1", apiKey: "{env:ROUTER_KEY}" },
        providers,
      }),
    ).toContain("provider.options.apiKey")
  })

  test("reports a project baseURL that points elsewhere", () => {
    expect(
      nineRouterConnectionProblem({
        baseURL: "http://127.0.0.1:20128/v1",
        options: { baseURL: "http://10.0.0.2:20128/v1" },
        providers,
      }),
    ).toContain("overrides this connection")
  })

  test("reports filters that hide every model", () => {
    for (const hidden of [[], [{ id: "9router", models: {} }], [{ id: "other", models: { combo: {} } }]]) {
      expect(nineRouterConnectionProblem({ baseURL: "http://127.0.0.1:20128/v1", providers: hidden })).toContain(
        "no models are enabled",
      )
    }
  })
})
