import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { DesignPresence } from "../src/design-presence"
import { DesignWaiting } from "../src/design-waiting"

const fixture = () => {
  const clock = { now: 1_000 }
  const presence = DesignPresence.make({ now: () => clock.now, debounce: 15_000 })
  const launches: string[] = []
  // Stands in for a client that launches a browser on a granted claim.
  const publish = (sessionID: string, input?: { explicit?: boolean }) => {
    const claim = presence.claim(sessionID, input)
    if (claim.outcome === "claimed") launches.push(sessionID)
    return claim
  }
  return { clock, presence, launches, publish }
}

describe("DesignPresence", () => {
  test("the first publish opens the review", () => {
    const { launches, publish } = fixture()
    expect(publish("ses_a").outcome).toBe("claimed")
    expect(launches).toEqual(["ses_a"])
  })

  test("rapid publishes open one tab", () => {
    const { clock, launches, publish } = fixture()
    Array.from({ length: 10 }).forEach(() => {
      publish("ses_a")
      clock.now += 500
    })
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

  test("a release after the page connected cannot open a second tab", () => {
    const { clock, presence, launches, publish } = fixture()
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

  test("hold counts a connection for the lifetime of its scope", async () => {
    const presence = DesignPresence.make()
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* DesignPresence.hold("ses_a", presence)
          yield* DesignPresence.hold("ses_a", presence)
          expect(presence.connected("ses_a")).toBe(2)
        }),
      ),
    )
    expect(presence.connected("ses_a")).toBe(0)
  })
})

describe("DesignWaiting", () => {
  test("shows the start's elapsed time and reloads until the app runs", () => {
    const page = DesignWaiting.page({ progress: { phase: "start", started: 1_000 }, now: 4_500 })
    expect(page).toContain("Starting the design app…")
    expect(page).toContain("<progress aria-label=")
    expect(page).toContain("3 s")
    expect(page).toContain('http-equiv="refresh"')
  })

  test("a failure stops reloading, escapes the reason and offers Retry", () => {
    const page = DesignWaiting.page({ error: "spawn <redcode-design> failed", now: 0 })
    expect(page).toContain("The design app did not start.")
    expect(page).toContain("spawn &lt;redcode-design&gt; failed")
    expect(page).toContain("Retry")
    expect(page).not.toContain('http-equiv="refresh"')
  })
})
