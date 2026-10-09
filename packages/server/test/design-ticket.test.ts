import { describe, expect, test } from "bun:test"
import { DesignAccess } from "../src/design-access"

describe("DesignAccess review tickets", () => {
  test("a link ticket grants one session's review until it expires", () => {
    const now = 5_000_000
    const value = DesignAccess.ticket("secret", "ses_review", DesignAccess.LINK_TTL, now)

    expect(DesignAccess.verify("secret", "ses_review", value, now)).toBe(true)
    expect(DesignAccess.verify("secret", "ses_review", value, now + DesignAccess.LINK_TTL)).toBe(true)
    expect(DesignAccess.verify("secret", "ses_review", value, now + DesignAccess.LINK_TTL + 1)).toBe(false)
  })

  test("a ticket for another session, another secret or with a forged expiry is refused", () => {
    const now = 5_000_000
    const value = DesignAccess.ticket("secret", "ses_review", DesignAccess.LINK_TTL, now)
    const forged = `${now + DesignAccess.COOKIE_TTL}.${value.split(".")[1]}`

    expect(DesignAccess.verify("secret", "ses_other", value, now)).toBe(false)
    expect(DesignAccess.verify("other-secret", "ses_review", value, now)).toBe(false)
    expect(DesignAccess.verify("secret", "ses_review", forged, now)).toBe(false)
    expect(DesignAccess.verify("secret", "ses_review", `${value}x`, now)).toBe(false)
    expect(DesignAccess.verify("secret", "ses_review", "soon.signature", now)).toBe(false)
    expect(DesignAccess.verify("secret", "ses_review", "", now)).toBe(false)
    expect(DesignAccess.verify("secret", "ses_review", undefined, now)).toBe(false)
  })

  test("the review cookie outlives the link it is exchanged for", () => {
    const now = 5_000_000
    const cookie = DesignAccess.ticket("secret", "ses_review", DesignAccess.COOKIE_TTL, now)

    expect(DesignAccess.COOKIE_TTL).toBeGreaterThan(DesignAccess.LINK_TTL)
    expect(DesignAccess.verify("secret", "ses_review", cookie, now + DesignAccess.LINK_TTL + 1)).toBe(true)
  })

  test("a review cookie is due for a fresh one only once it is older than the renewal interval", () => {
    const now = 5_000_000
    const issued = DesignAccess.ticket("secret", "ses_review", DesignAccess.COOKIE_TTL, now)

    expect(DesignAccess.renewal(issued, now)).toBe(false)
    expect(DesignAccess.renewal(issued, now + DesignAccess.COOKIE_RENEWAL)).toBe(false)
    expect(DesignAccess.renewal(issued, now + DesignAccess.COOKIE_RENEWAL + 1)).toBe(true)
    expect(DesignAccess.COOKIE_RENEWAL).toBeLessThan(DesignAccess.COOKIE_TTL)
  })

  test("an embedded server without a password keeps one secret for its lifetime", () => {
    const secret = DesignAccess.embeddedSecret()

    expect(secret.length).toBeGreaterThan(20)
    expect(DesignAccess.embeddedSecret()).toBe(secret)
  })
})
