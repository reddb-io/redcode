import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { DesignReviewPresence } from "../src/design/review-presence"

const fixture = () => {
  const clock = { now: 1_000 }
  const presence = DesignReviewPresence.make({ now: () => clock.now, debounce: 15_000 })
  const launches: string[] = []
  // Stands in for a browser launcher: what the Design tool and `redcode design` do on a granted claim.
  const publish = (sessionID: string, input?: { explicit?: boolean; connected?: number }) => {
    if (presence.claim(sessionID, input)) launches.push(sessionID)
  }
  return { clock, presence, launches, publish }
}

describe("DesignReviewPresence", () => {
  test("the first publish opens the review", () => {
    const { launches, publish } = fixture()
    publish("ses_a")
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

  test("a publish while a review page is connected does not open another", () => {
    const { clock, presence, launches, publish } = fixture()
    publish("ses_a")
    presence.connect("ses_a")
    clock.now += 60_000
    publish("ses_a")
    publish("ses_a", { explicit: true })
    expect(launches).toEqual(["ses_a"])
    expect(presence.connected("ses_a")).toBe(1)
  })

  test("after the page disconnects and the debounce passes, a publish opens it again", () => {
    const { clock, presence, launches, publish } = fixture()
    publish("ses_a")
    const release = presence.connect("ses_a")
    clock.now += 1_000
    release()
    release()
    expect(presence.connected("ses_a")).toBe(0)
    publish("ses_a")
    expect(launches).toEqual(["ses_a"])
    clock.now += 15_000
    publish("ses_a")
    publish("ses_a")
    expect(launches).toEqual(["ses_a", "ses_a"])
  })

  test("a launched page that never connects is not reopened by later publishes", () => {
    const { clock, launches, publish } = fixture()
    publish("ses_a")
    clock.now += 60_000
    publish("ses_a")
    expect(launches).toEqual(["ses_a"])
    // An explicit request (reopen, /review) still opens once the debounce has passed.
    publish("ses_a", { explicit: true })
    publish("ses_a", { explicit: true })
    expect(launches).toEqual(["ses_a", "ses_a"])
  })

  test("sessions are independent, and a remote connection count blocks the claim", () => {
    const { launches, publish } = fixture()
    publish("ses_a")
    publish("ses_b", { connected: 2 })
    publish("ses_c")
    expect(launches).toEqual(["ses_a", "ses_c"])
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
})
