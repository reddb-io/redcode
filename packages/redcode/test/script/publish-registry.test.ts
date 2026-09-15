import { describe, expect, test } from "bun:test"
import {
  isPublishConflict,
  publishOnce,
  publishRelease,
  waitForVisibility,
  type RegistryDeps,
  type RegistryPackage,
} from "../../script/publish-registry"

const version = "0.31.1"
const options = { timeoutMs: 10 * 60_000, initialDelayMs: 5_000, maxDelayMs: 60_000 }

// A mocked npm registry with a fake clock. `visibleAfter` is the fake time at which `npm view`
// starts resolving a package once it has been published; Infinity models a stuck read replica.
function fakeNpm(input: { preexisting?: string[]; visibleAfter?: Record<string, number> } = {}) {
  const events: string[] = []
  const logs: string[] = []
  const sleeps: number[] = []
  const publishedAt = new Map<string, number>()
  for (const name of input.preexisting ?? []) publishedAt.set(name, 0)
  let clock = 0
  const deps: RegistryDeps = {
    published: async (name) => {
      events.push(`view:${name}`)
      const at = publishedAt.get(name)
      if (at === undefined) return false
      return clock >= at + (input.visibleAfter?.[name] ?? 0)
    },
    sleep: async (ms) => {
      sleeps.push(ms)
      clock += ms
    },
    now: () => clock,
    log: (message) => logs.push(message),
  }
  const pkg = (name: string, publish?: () => Promise<void>): RegistryPackage => ({
    name,
    version,
    publish:
      publish ??
      (async () => {
        events.push(`publish:${name}`)
        publishedAt.set(name, clock)
      }),
  })
  return { deps, events, logs, sleeps, pkg, now: () => clock }
}

function conflictError() {
  return Object.assign(new Error("Failed with exit code 1"), {
    stderr: Buffer.from(
      "npm error code E409\nnpm error 409 Conflict - PUT https://registry.npmjs.org/@reddb-io%2fredcode-darwin-arm64 - Cannot publish over previously published version \"0.31.1\".",
    ),
  })
}

describe("isPublishConflict", () => {
  test("recognises npm's republish rejections", () => {
    expect(isPublishConflict(conflictError())).toBe(true)
    expect(isPublishConflict(new Error("You cannot publish over the previously published versions: 0.31.1."))).toBe(
      true,
    )
    expect(isPublishConflict(new Error("npm error 409 Conflict"))).toBe(true)
  })

  test("ignores unrelated failures", () => {
    expect(isPublishConflict(new Error("npm error code E403 forbidden"))).toBe(false)
    expect(isPublishConflict(new Error("ENOTFOUND registry.npmjs.org"))).toBe(false)
  })
})

describe("publishOnce", () => {
  test("skips a version npm view already serves", async () => {
    const npm = fakeNpm({ preexisting: ["@reddb-io/redcode-linux-x64"] })
    expect(await publishOnce(npm.pkg("@reddb-io/redcode-linux-x64"), npm.deps)).toBe("skipped")
    expect(npm.events).not.toContain("publish:@reddb-io/redcode-linux-x64")
  })

  test("treats a 409 conflict as already published", async () => {
    const npm = fakeNpm()
    const item = npm.pkg("@reddb-io/redcode-darwin-arm64", async () => {
      throw conflictError()
    })
    expect(await publishOnce(item, npm.deps)).toBe("conflict")
    expect(npm.logs.join("\n")).toContain("@reddb-io/redcode-darwin-arm64@0.31.1 was already published")
  })

  test("rethrows any other publish error", async () => {
    const npm = fakeNpm()
    const failure = new Error("npm error code E403 forbidden")
    const item = npm.pkg("@reddb-io/redcode-darwin-arm64", async () => {
      throw failure
    })
    await expect(publishOnce(item, npm.deps)).rejects.toBe(failure)
  })
})

describe("waitForVisibility", () => {
  test("polls with backoff on the injected clock until every package is served", async () => {
    const npm = fakeNpm({ preexisting: ["a", "b"], visibleAfter: { a: 12_000, b: 40_000 } })
    await waitForVisibility(
      [
        { name: "a", version },
        { name: "b", version },
      ],
      npm.deps,
      options,
    )
    expect(npm.sleeps).toEqual([5_000, 10_000, 20_000, 40_000])
    expect(npm.now()).toBe(75_000)
  })

  test("caps the wait at the timeout and names the missing packages", async () => {
    const npm = fakeNpm({ preexisting: ["a", "b"], visibleAfter: { a: 0, b: Infinity } })
    const error = await waitForVisibility(
      [
        { name: "a", version },
        { name: "b", version },
      ],
      npm.deps,
      options,
    ).catch((error: Error) => error)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("b@0.31.1")
    expect((error as Error).message).not.toContain("a@0.31.1")
    expect(npm.now()).toBe(options.timeoutMs)
  })
})

describe("publishRelease", () => {
  const platforms = ["@reddb-io/redcode-linux-x64", "@reddb-io/redcode-darwin-arm64"]
  const main = "@reddb-io/redcode"

  test("publishes the main package only after every platform package is visible", async () => {
    const npm = fakeNpm({ visibleAfter: { [platforms[0]]: 7_000, [platforms[1]]: 30_000 } })
    expect(
      await publishRelease({ platforms: platforms.map((name) => npm.pkg(name)), main: npm.pkg(main) }, npm.deps, options),
    ).toBe("published")
    const mainPublish = npm.events.indexOf(`publish:${main}`)
    for (const name of platforms) expect(npm.events.indexOf(`publish:${name}`)).toBeLessThan(mainPublish)
    expect(npm.now()).toBeGreaterThanOrEqual(30_000)
    expect(npm.events.lastIndexOf(`view:${platforms[1]}`)).toBeLessThan(mainPublish)
  })

  test("continues past a platform conflict on rerun", async () => {
    const npm = fakeNpm({ preexisting: [platforms[1]], visibleAfter: { [platforms[1]]: 20_000 } })
    const conflicted = npm.pkg(platforms[1], async () => {
      throw conflictError()
    })
    expect(await publishRelease({ platforms: [npm.pkg(platforms[0]), conflicted], main: npm.pkg(main) }, npm.deps, options)).toBe(
      "published",
    )
    expect(npm.events).toContain(`publish:${main}`)
  })

  test("refuses to publish the main package when platforms never become visible", async () => {
    const npm = fakeNpm({ visibleAfter: { [platforms[1]]: Infinity } })
    const error = await publishRelease(
      { platforms: platforms.map((name) => npm.pkg(name)), main: npm.pkg(main) },
      npm.deps,
      options,
    ).catch((error: Error) => error)
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toContain(`${platforms[1]}@0.31.1`)
    expect(message).not.toContain(`${platforms[0]}@0.31.1`)
    expect(message).toContain(`not publishing ${main}@0.31.1`)
    expect(npm.events).not.toContain(`publish:${main}`)
  })
})
