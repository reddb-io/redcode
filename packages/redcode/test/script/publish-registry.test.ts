import { describe, expect, test } from "bun:test"
import {
  isPublishConflict,
  isStagedConflict,
  publishOnce,
  StagedPublishError,
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
      'npm error code E409\nnpm error 409 Conflict - PUT https://registry.npmjs.org/@reddb-io%2fredcode-darwin-arm64 - Cannot publish over previously published version "0.31.1".',
    ),
  })
}

function stagedError(name = "@reddb-io/redcode-darwin-arm64") {
  return Object.assign(new Error("Failed with exit code 1"), {
    stderr: Buffer.from(
      `npm notice npm tokens that bypass 2FA are being restricted for account changes and direct publishing.\nnpm error code E409\nnpm error 409 Conflict - PUT https://registry.npmjs.org/${name.replace("/", "%2f")} - Cannot publish over previously staged version "0.31.1".`,
    ),
  })
}

// Models npm turning a token publish into a staged publish: `npm publish` succeeds, `npm view`
// never serves the version, and every later publish attempt fails with "previously staged".
function stagingNpm(stagedNames: string[], input: { visibleAfter?: Record<string, number> } = {}) {
  const npm = fakeNpm({ visibleAfter: Object.fromEntries(stagedNames.map((name) => [name, Infinity])), ...input })
  const attempts = new Map<string, number>()
  const pkg = (name: string) => {
    if (!stagedNames.includes(name)) return npm.pkg(name)
    const inner = npm.pkg(name)
    return {
      ...inner,
      publish: async () => {
        const count = (attempts.get(name) ?? 0) + 1
        attempts.set(name, count)
        if (count > 1) {
          npm.events.push(`staged-conflict:${name}`)
          throw stagedError(name)
        }
        await inner.publish()
      },
    }
  }
  return { ...npm, pkg, attempts }
}

describe("isStagedConflict", () => {
  test("recognises npm's staged republish rejection and keeps it apart from a plain conflict", () => {
    expect(isStagedConflict(stagedError())).toBe(true)
    expect(isPublishConflict(stagedError())).toBe(false)
    expect(isStagedConflict(conflictError())).toBe(false)
    expect(isStagedConflict(new Error("npm error code E403 forbidden"))).toBe(false)
  })
})

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
      await publishRelease(
        { platforms: platforms.map((name) => npm.pkg(name)), main: npm.pkg(main) },
        npm.deps,
        options,
      ),
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
    expect(
      await publishRelease({ platforms: [npm.pkg(platforms[0]), conflicted], main: npm.pkg(main) }, npm.deps, options),
    ).toBe("published")
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
    expect(message).toContain("looks like registry lag")
    expect(error).not.toBeInstanceOf(StagedPublishError)
    expect(message).not.toContain("This is not registry lag")
    expect(npm.events).not.toContain(`publish:${main}`)
  })

  test("reports silently staged platform packages after the wait, with links and approval steps", async () => {
    const staged = ["@reddb-io/redcode-darwin-arm64", "@reddb-io/redcode-linux-x64-musl"]
    const all = ["@reddb-io/redcode-linux-x64", ...staged]
    const npm = stagingNpm(staged)
    const error = await publishRelease(
      { platforms: all.map((name) => npm.pkg(name)), main: npm.pkg(main) },
      npm.deps,
      options,
    ).catch((error: Error) => error)
    expect(error).toBeInstanceOf(StagedPublishError)
    expect((error as StagedPublishError).staged.map((item) => item.name)).toEqual(staged)
    const message = (error as Error).message
    for (const name of staged) {
      expect(message).toContain(`${name}@0.31.1`)
      expect(message).toContain(`https://www.npmjs.com/package/${name}`)
    }
    expect(message).not.toContain("@reddb-io/redcode-linux-x64@0.31.1")
    expect(message).toContain("This is not registry lag")
    expect(message).toContain("npx npm@11.19.1 stage approve <stage-id>")
    expect(message).toContain("npx npm@11.19.1 stage reject <stage-id>")
    expect(message).toContain("https://docs.npmjs.com/trusted-publishers")
    expect(message).toContain(`Not publishing ${main}@0.31.1`)
    // The probe happens only after the full visibility wait, exactly once per missing package.
    expect(npm.now()).toBe(options.timeoutMs)
    for (const name of staged) expect(npm.attempts.get(name)).toBe(2)
    expect(npm.attempts.has("@reddb-io/redcode-linux-x64")).toBe(false)
    expect(npm.events).not.toContain(`publish:${main}`)
  })

  test("fails fast without waiting when a rerun hits a version that is already staged", async () => {
    const npm = fakeNpm()
    const staged = npm.pkg(platforms[1], async () => {
      throw stagedError(platforms[1])
    })
    const error = await publishRelease(
      { platforms: [npm.pkg(platforms[0]), staged], main: npm.pkg(main) },
      npm.deps,
      options,
    ).catch((error: Error) => error)
    expect(error).toBeInstanceOf(StagedPublishError)
    expect((error as Error).message).toContain(`${platforms[1]}@0.31.1`)
    expect(npm.sleeps).toEqual([])
    expect(npm.events).not.toContain(`publish:${main}`)
  })

  test("reports the main package when npm stages it", async () => {
    const npm = fakeNpm()
    const stagedMain = npm.pkg(main, async () => {
      throw stagedError(main)
    })
    const error = await publishRelease(
      { platforms: platforms.map((name) => npm.pkg(name)), main: stagedMain },
      npm.deps,
      options,
    ).catch((error: Error) => error)
    expect(error).toBeInstanceOf(StagedPublishError)
    expect((error as Error).message).toContain(`${main}@0.31.1  https://www.npmjs.com/package/${main}`)
  })
})

describe("publishRelease probe after the visibility wait", () => {
  const lost = "@reddb-io/redcode-darwin-arm64"
  const live = "@reddb-io/redcode-linux-x64"
  const main = "@reddb-io/redcode"

  // A platform package whose publish attempts follow a script: "lost" returns success without
  // reaching the registry, "publish" really publishes, and an Error is thrown as npm's failure.
  function scripted(npm: ReturnType<typeof fakeNpm>, name: string, steps: Array<"lost" | "publish" | Error>) {
    const real = npm.pkg(name)
    let attempt = 0
    const item: RegistryPackage = {
      ...real,
      publish: async () => {
        const step = steps[Math.min(attempt, steps.length - 1)]
        attempt++
        npm.events.push(`attempt:${name}`)
        if (step instanceof Error) throw step
        if (step === "publish") await real.publish()
      },
    }
    return { item, attempts: () => attempt }
  }

  test("a probe that republishes waits once more and then publishes the main package", async () => {
    const npm = fakeNpm()
    const platform = scripted(npm, lost, ["lost", "publish"])
    expect(
      await publishRelease({ platforms: [npm.pkg(live), platform.item], main: npm.pkg(main) }, npm.deps, options),
    ).toBe("published")
    expect(platform.attempts()).toBe(2)
    expect(npm.logs.join("\n")).toContain(`republished ${lost}@0.31.1; waiting once more`)
    expect(npm.events).toContain(`publish:${main}`)
    expect(npm.now()).toBe(options.timeoutMs)
  })

  test("a probe that republishes but stays invisible fails as registry lag after one more wait", async () => {
    const npm = fakeNpm({ visibleAfter: { [lost]: Infinity } })
    const platform = scripted(npm, lost, ["lost", "publish"])
    const error = await publishRelease(
      { platforms: [npm.pkg(live), platform.item], main: npm.pkg(main) },
      npm.deps,
      options,
    ).catch((error: Error) => error)
    expect(error).not.toBeInstanceOf(StagedPublishError)
    expect((error as Error).message).toContain("looks like registry lag")
    expect(platform.attempts()).toBe(2)
    expect(npm.now()).toBe(2 * options.timeoutMs)
    expect(npm.events).not.toContain(`publish:${main}`)
  })

  test("a probe answering previously published fails as registry lag without waiting again", async () => {
    const npm = fakeNpm()
    const platform = scripted(npm, lost, ["lost", conflictError()])
    const error = await publishRelease(
      { platforms: [npm.pkg(live), platform.item], main: npm.pkg(main) },
      npm.deps,
      options,
    ).catch((error: Error) => error)
    expect(error).not.toBeInstanceOf(StagedPublishError)
    const message = (error as Error).message
    expect(message).toContain(`did not serve ${lost}@0.31.1`)
    expect(message).toContain("looks like registry lag")
    expect(platform.attempts()).toBe(2)
    expect(npm.now()).toBe(options.timeoutMs)
    expect(npm.events).not.toContain(`publish:${main}`)
  })

  test("a probe that errors keeps the timeout in the failure and names the probe error", async () => {
    const npm = fakeNpm()
    const platform = scripted(npm, lost, ["lost", new Error("getaddrinfo ENOTFOUND registry.npmjs.org")])
    const error = await publishRelease(
      { platforms: [npm.pkg(live), platform.item], main: npm.pkg(main) },
      npm.deps,
      options,
    ).catch((error: Error) => error)
    const message = (error as Error).message
    expect(message).toContain(`npm registry did not serve ${lost}@0.31.1 within 600s`)
    expect(message).toContain(`${lost}@0.31.1: getaddrinfo ENOTFOUND registry.npmjs.org`)
    expect((error as Error).cause).toBeInstanceOf(Error)
    expect(npm.now()).toBe(options.timeoutMs)
    expect(npm.events).not.toContain(`publish:${main}`)
  })
})

describe("publishOnce staged", () => {
  test("returns staged instead of treating a staged 409 as already published", async () => {
    const npm = fakeNpm()
    const item = npm.pkg("@reddb-io/redcode-darwin-arm64", async () => {
      throw stagedError()
    })
    expect(await publishOnce(item, npm.deps)).toBe("staged")
    expect(npm.logs.join("\n")).toContain("is staged and waiting for maintainer approval")
  })
})
