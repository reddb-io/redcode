import { describe, expect, test } from "bun:test"
import { createBrowserActivity } from "./activity"

describe("browser activity leases", () => {
  test("wakes once for overlapping work and throttles after the final release", () => {
    const changes: boolean[] = []
    const activity = createBrowserActivity((throttled) => changes.push(throttled))
    const first = activity.acquire()
    const second = activity.acquire()

    first()
    first()
    expect(activity.active()).toBe(1)
    second()

    expect(changes).toEqual([true, false, true])
  })

  test("releases rejected work and ignores leases after disposal", async () => {
    const changes: boolean[] = []
    const activity = createBrowserActivity((throttled) => changes.push(throttled))

    await expect(
      activity.during(async () => {
        throw new Error("failed")
      }),
    ).rejects.toThrow("failed")
    activity.dispose()
    activity.acquire()()

    expect(activity.active()).toBe(0)
    expect(changes).toEqual([true, false, true, true])
  })
})
