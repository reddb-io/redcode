import { describe, expect, test } from "bun:test"
import { DesignAccess } from "../src/design-access"

describe("DesignAccess.reviewOrigin", () => {
  test("keeps the address the client reached, so remote clients get a link they can open", () => {
    expect(DesignAccess.reviewOrigin("127.0.0.1:4096")).toBe("http://127.0.0.1:4096")
    expect(DesignAccess.reviewOrigin("192.168.1.20:4096")).toBe("http://192.168.1.20:4096")
    expect(DesignAccess.reviewOrigin("devbox.local:4096")).toBe("http://devbox.local:4096")
    expect(DesignAccess.reviewOrigin("[fe80::1]:4096")).toBe("http://[fe80::1]:4096")
  })

  test("turns a wildcard bind address into loopback and a missing Host into localhost", () => {
    expect(DesignAccess.reviewOrigin("0.0.0.0:4096")).toBe("http://127.0.0.1:4096")
    expect(DesignAccess.reviewOrigin("[::]:4096")).toBe("http://127.0.0.1:4096")
    expect(DesignAccess.reviewOrigin(undefined)).toBe("http://localhost")
    expect(DesignAccess.reviewOrigin("")).toBe("http://localhost")
    expect(DesignAccess.reviewOrigin("bad host")).toBe("http://localhost")
  })
})

describe("DesignAccess.launchRefusal", () => {
  const claim = (input: Partial<Parameters<typeof DesignAccess.launchRefusal>[0]> = {}) =>
    DesignAccess.launchRefusal({
      trusted: true,
      origin: undefined,
      host: "127.0.0.1:4096",
      contentType: "application/json",
      ...input,
    })

  test("a credentialed JSON claim from the server's own origin or a non-browser client goes on", () => {
    expect(claim()).toBeUndefined()
    expect(claim({ origin: "http://127.0.0.1:4096" })).toBeUndefined()
    expect(claim({ origin: "http://192.168.1.20:4096", host: "192.168.1.20:4096" })).toBeUndefined()
  })

  test("the desktop and development app origins the CORS policy admits may claim", () => {
    expect(claim({ origin: "oc://renderer" })).toBeUndefined()
    expect(claim({ origin: "http://localhost:5173" })).toBeUndefined()
    expect(claim({ origin: "http://192.168.1.10:3001", cors: { cors: ["http://192.168.1.10:3001"] } })).toBeUndefined()
  })

  test("other origins, missing credentials and non-JSON bodies are refused", () => {
    expect(claim({ origin: "https://evil.test" })?.status).toBe(403)
    expect(claim({ origin: "null" })?.status).toBe(403)
    expect(claim({ origin: "http://192.168.1.10:3001" })?.status).toBe(403)
    expect(claim({ trusted: false, origin: "oc://renderer" })?.status).toBe(401)
    expect(claim({ contentType: "text/plain" })?.status).toBe(403)
    expect(claim({ contentType: undefined })?.status).toBe(403)
  })
})
