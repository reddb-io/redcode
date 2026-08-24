import { describe, expect, test } from "bun:test"
import type { RedskilledStatusResponse } from "@reddb-io/redcode-sdk/v2"
import { isRedskilledConnected, redskilledConnectionTone } from "../../src/context/redskilled"

const status = (lifecycle: RedskilledStatusResponse["lifecycle"]) =>
  ({ lifecycle }) as RedskilledStatusResponse

describe("isRedskilledConnected", () => {
  test("treats native and ACP snapshots as connected", () => {
    expect(isRedskilledConnected(status("live"))).toBe(true)
    expect(isRedskilledConnected(status("degraded"))).toBe(true)
  })

  test("keeps unavailable or incomplete connections gray", () => {
    expect(isRedskilledConnected(undefined)).toBe(false)
    expect(isRedskilledConnected(status("connecting"))).toBe(false)
    expect(isRedskilledConnected(status("needs_consent"))).toBe(false)
    expect(isRedskilledConnected(status("unavailable"))).toBe(false)
    expect(isRedskilledConnected(status("ineligible"))).toBe(false)
    expect(isRedskilledConnected(status("refused"))).toBe(false)
  })
})

describe("redskilledConnectionTone", () => {
  test("distinguishes live, degraded, and disconnected states", () => {
    expect(redskilledConnectionTone(status("live"))).toBe("connected")
    expect(redskilledConnectionTone(status("degraded"))).toBe("degraded")
    expect(redskilledConnectionTone(status("connecting"))).toBe("disconnected")
    expect(redskilledConnectionTone(undefined)).toBe("disconnected")
  })
})
