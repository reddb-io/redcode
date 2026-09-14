import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { DesignReviewPresence } from "../src/design/review-presence"

const fixture = () => {
  const clock = { now: 1_000 }
  const presence = DesignReviewPresence.make({ now: () => clock.now, debounce: 15_000 })
  const launches: string[] = []
  // Stands in for a browser launcher: what the Design tool does on a granted claim.
  const publish = (sessionID: string, input?: { explicit?: boolean }) => {
    const claim = presence.claim(sessionID, input)
    if (claim.outcome === "claimed") launches.push(sessionID)
    return claim
  }
  return { clock, presence, launches, publish }
}

describe("DesignReviewPresence", () => {
  test("the first publish opens the review", () => {
    const { launches, publish } = fixture()
    expect(publish("ses_a").outcome).toBe("claimed")
    expect(launches).toEqual(["ses_a"])
  })

  test("rapid publishes open one tab", () => {
    const { clock, launches, publish } = fixture()
    for (let index = 0; index < 10; index++) {
      publish("ses_a")
      clock.now += 500
    }
    expect(launches).toEqual(["ses_a"])
  })

  test("a publish or explicit request while a review page is connected does not open another", () => {
    const { clock, presence, launches, publish } = fixture()
    publish("ses_a")
    presence.connect("ses_a")
    clock.now += 60_000
    expect(publish("ses_a").outcome).toBe("connected")
    expect(publish("ses_a", { explicit: true }).outcome).toBe("connected")
    expect(launches).toEqual(["ses_a"])
    expect(presence.connected("ses_a")).toBe(1)
  })

  test("after the page disconnects and the debounce passes, a publish opens it again", () => {
    const { clock, presence, launches, publish } = fixture()
    publish("ses_a")
    const release = presence.connect("ses_a")
    clock.now += 20_000
    release()
    release()
    expect(presence.connected("ses_a")).toBe(0)
    // A reload reconnects inside the debounce, so a publish right after a disconnect waits.
    expect(publish("ses_a").outcome).toBe("pending")
    clock.now += 15_000
    publish("ses_a")
    publish("ses_a")
    expect(launches).toEqual(["ses_a", "ses_a"])
  })

  test("an explicit open records its claim, so a publish inside the debounce opens no second tab", () => {
    const { clock, launches, publish } = fixture()
    expect(publish("ses_a", { explicit: true }).outcome).toBe("claimed")
    clock.now += 2_000
    expect(publish("ses_a").outcome).toBe("pending")
    expect(publish("ses_a", { explicit: true }).outcome).toBe("pending")
    expect(launches).toEqual(["ses_a"])
  })

  test("a launched page that never connects is not reopened by publishes, only by an explicit request", () => {
    const { clock, launches, publish } = fixture()
    publish("ses_a")
    clock.now += 60_000
    expect(publish("ses_a").outcome).toBe("pending")
    publish("ses_a", { explicit: true })
    publish("ses_a", { explicit: true })
    expect(launches).toEqual(["ses_a", "ses_a"])
  })

  test("a failed launch gives its claim back, so the next publish tries again", () => {
    const { presence, launches, publish } = fixture()
    const first = publish("ses_a")
    if (first.outcome !== "claimed") throw new Error("expected a claim")
    presence.release("ses_a", first.token)
    presence.release("ses_a", first.token)
    expect(publish("ses_a").outcome).toBe("claimed")
    // A stale token cannot undo the newer claim.
    presence.release("ses_a", first.token)
    expect(publish("ses_a").outcome).toBe("pending")
    expect(launches).toEqual(["ses_a", "ses_a"])
  })

  test("a stale release after the launch settled or the page connected cannot open a second tab", async () => {
    const { clock, presence, launches, publish } = fixture()
    // The launch succeeds and settles; a stray release of its token arrives before the page connects.
    expect(
      await Effect.runPromise(
        DesignReviewPresence.launch({ sessionID: "ses_a", presence, open: Effect.succeed(true) }),
      ),
    ).toBe("claimed")
    await Bun.sleep(10)
    presence.release("ses_a", 1)
    clock.now += 2_000
    expect(publish("ses_a").outcome).toBe("pending")
    expect(publish("ses_a", { explicit: true }).outcome).toBe("pending")
    // Claim, the page connects and closes, then a stale release: an explicit request inside the debounce opens nothing.
    const claim = publish("ses_b")
    if (claim.outcome !== "claimed") throw new Error("expected a claim")
    presence.connect("ses_b")()
    presence.release("ses_b", claim.token)
    clock.now += 2_000
    expect(publish("ses_b", { explicit: true }).outcome).toBe("pending")
    expect(launches).toEqual(["ses_b"])
  })

  test("settled sessions are dropped; a launched page that never connected is kept", () => {
    const { clock, presence, publish } = fixture()
    publish("ses_closed")
    presence.connect("ses_closed")()
    publish("ses_unseen")
    presence.connected("ses_other")
    expect(presence.size()).toBe(2)
    clock.now += 15_000
    expect(presence.size()).toBe(1)
    const failed = publish("ses_failed")
    if (failed.outcome === "claimed") presence.release("ses_failed", failed.token)
    expect(presence.size()).toBe(1)
  })

  test("the default clock is monotonic", () => {
    const presence = DesignReviewPresence.make({ debounce: 60_000 })
    const original = Date.now
    Date.now = () => original() + 3_600_000
    try {
      expect(presence.claim("ses_a").outcome).toBe("claimed")
      Date.now = () => original() + 7_200_000
      expect(presence.claim("ses_a").outcome).toBe("pending")
    } finally {
      Date.now = original
    }
  })

  test("hold counts a connection for the lifetime of its scope", async () => {
    const presence = DesignReviewPresence.make()
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* DesignReviewPresence.hold("ses_a", presence)
          yield* DesignReviewPresence.hold("ses_a", presence)
          expect(presence.connected("ses_a")).toBe(2)
        }),
      ),
    )
    expect(presence.connected("ses_a")).toBe(0)
  })

  test("launch requests once, and a launch that opens no browser gives the claim back", async () => {
    const presence = DesignReviewPresence.make()
    const opened: boolean[] = []
    const run = (result: boolean) =>
      Effect.runPromise(
        DesignReviewPresence.launch({
          sessionID: "ses_a",
          presence,
          open: Effect.sync(() => {
            opened.push(result)
            return result
          }),
        }),
      )
    expect(await run(false)).toBe("claimed")
    await Bun.sleep(10)
    expect(opened).toEqual([false])
    expect(await run(true)).toBe("claimed")
    await Bun.sleep(10)
    expect(await run(true)).toBe("pending")
    expect(opened).toEqual([false, true])
  })
})

describe("DesignReviewPresence.openExplicit", () => {
  const server = (presence = DesignReviewPresence.make()) => {
    const calls: string[] = []
    return {
      presence,
      calls,
      claim: async () => {
        calls.push("claim")
        return { ...presence.claim("ses_a", { explicit: true }), url: "http://review" }
      },
      release: async (token: number) => {
        calls.push(`release:${token}`)
        presence.release("ses_a", token)
      },
    }
  }

  test("opens when nothing is connected and records the claim on the server", async () => {
    const remote = server()
    const launched: string[] = []
    const launch = async (url: string) => {
      launched.push(url)
      return true
    }
    expect(await DesignReviewPresence.openExplicit({ sessionID: "ses_a", ...remote, launch })).toEqual({
      status: "opened",
      url: "http://review",
      local: false,
    })
    // The agent publishes two seconds later, before the page connects: no second tab.
    expect(remote.presence.claim("ses_a").outcome).toBe("pending")
    expect(launched).toEqual(["http://review"])
  })

  test("a connected page is reported instead of opening a duplicate", async () => {
    const remote = server()
    remote.presence.connect("ses_a")
    const launched: string[] = []
    const result = await DesignReviewPresence.openExplicit({
      sessionID: "ses_a",
      ...remote,
      launch: async (url) => {
        launched.push(url)
        return true
      },
    })
    expect(result.status).toBe("connected")
    expect(launched).toEqual([])
  })

  test("a failed launch releases the server claim", async () => {
    const remote = server()
    const result = await DesignReviewPresence.openExplicit({ sessionID: "ses_a", ...remote, launch: async () => false })
    expect(result.status).toBe("failed")
    expect(remote.calls).toEqual(["claim", "release:1"])
    expect(remote.presence.claim("ses_a").outcome).toBe("claimed")
  })

  test("a disabled launcher claims nothing", async () => {
    const remote = server()
    const result = await DesignReviewPresence.openExplicit({
      sessionID: "ses_a",
      disabled: "REDCODE_NO_BROWSER",
      ...remote,
      launch: async () => true,
    })
    expect(result.status).toBe("disabled")
    expect(remote.calls).toEqual([])
  })

  test("a server without the launch route falls back to a local claim, or reports unavailable", async () => {
    const local = DesignReviewPresence.make()
    const claim = async () => {
      throw new Error("404")
    }
    const release = async () => undefined
    const launch = async () => true
    expect(
      await DesignReviewPresence.openExplicit({ sessionID: "ses_a", claim, release, launch, url: "http://v2", local }),
    ).toEqual({ status: "opened", url: "http://v2", local: true })
    expect(
      (await DesignReviewPresence.openExplicit({ sessionID: "ses_a", claim, release, launch, url: "http://v2", local }))
        .status,
    ).toBe("pending")
    expect((await DesignReviewPresence.openExplicit({ sessionID: "ses_b", claim, release, launch })).status).toBe(
      "unavailable",
    )
  })

  test("parseClaim accepts only well-formed replies", () => {
    expect(DesignReviewPresence.parseClaim({ outcome: "claimed", token: 2, url: "u" })).toEqual({
      outcome: "claimed",
      token: 2,
      url: "u",
    })
    expect(DesignReviewPresence.parseClaim({ outcome: "claimed" })).toBeUndefined()
    expect(DesignReviewPresence.parseClaim({ outcome: "open" })).toBeUndefined()
    expect(DesignReviewPresence.parseClaim(null)).toBeUndefined()
  })
})
