import { describe, expect, test } from "bun:test"
import { deliveryResources, pullRequestURL } from "./resources-model"

describe("delivery resource boundary", () => {
  test("normalizes repository PR identities and rejects non-PR and executable links", () => {
    expect(pullRequestURL(" https://github.com/reddb-io/redcode/pull/42/?tab=files#diff ")).toBe(
      "https://github.com/reddb-io/redcode/pull/42",
    )
    expect(pullRequestURL("https://git.example.com/team/project/pull/7")).toBe(
      "https://git.example.com/team/project/pull/7",
    )
    for (const value of [
      "javascript:alert(1)",
      "file:///repo/pull/42",
      "http://github.com/a/b/pull/1",
      "https://user:secret@github.com/a/b/pull/1",
      "https://github.com/a/b/issues/1",
      "https://github.com/a/b/pull/0",
      "not a URL",
    ])
      expect(pullRequestURL(value)).toBeUndefined()
  })

  test("unsupported annotations stay distinguishable from an empty resource list", () => {
    expect(deliveryResources(undefined).invalid).toBe(false)
    expect(deliveryResources({ "redcode.delivery": { version: 2, pullRequests: [], harnesses: [] } }).invalid).toBe(
      true,
    )
    expect(
      deliveryResources({ "redcode.delivery": { version: 1, pullRequests: ["javascript:alert(1)"], harnesses: [] } })
        .invalid,
    ).toBe(true)
    expect(
      deliveryResources({
        "redcode.delivery": {
          version: 1,
          pullRequests: ["https://github.com/a/b/pull/7"],
          harnesses: [{ driver: "codex", runID: "run-one" }],
        },
      }).invalid,
    ).toBe(false)
  })
})
