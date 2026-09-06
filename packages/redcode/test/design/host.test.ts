import { describe, expect, test } from "bun:test"
import os from "node:os"
import { DesignHost } from "@/design/host"

describe("which names the surface answers to", () => {
  test("its own, with or without a port, and nothing that merely resolves here", () => {
    expect(DesignHost.allowed(undefined)).toBe(true)
    expect(DesignHost.allowed("localhost:4096")).toBe(true)
    expect(DesignHost.allowed("127.0.0.1")).toBe(true)
    expect(DesignHost.allowed("[::1]:4096")).toBe(true)
    expect(DesignHost.allowed(os.hostname().toUpperCase() + ":4096")).toBe(true)
    expect(DesignHost.allowed("evil.example:4096")).toBe(false)
    expect(DesignHost.allowed("")).toBe(false)
    // The bound hostname and anything the person configured count too.
    expect(DesignHost.allowed("studio.lan:4096", ["studio.lan"])).toBe(true)
    expect(DesignHost.allowed("Studio.LAN", ["studio.lan"])).toBe(true)
  })

  test("reads the host out of a Host header", () => {
    expect(DesignHost.hostOf("Example.com:80")).toBe("example.com")
    expect(DesignHost.hostOf("[fe80::1]:4096")).toBe("[fe80::1]")
    expect(DesignHost.hostOf("10.0.0.2")).toBe("10.0.0.2")
  })

  test("offers another device a URL only when the server listens beyond loopback", () => {
    expect(DesignHost.networkURL(undefined)).toBeUndefined()
    expect(DesignHost.networkURL(new URL("http://127.0.0.1:4096/"))).toBeUndefined()
    expect(DesignHost.networkURL(new URL("http://localhost:4096/"))).toBeUndefined()
    expect(DesignHost.networkURL(new URL("http://studio.lan:4096/"))).toBe("http://studio.lan:4096")
    // A wildcard bind becomes a real address, or nothing when the machine has none.
    const wildcard = DesignHost.networkURL(new URL("http://0.0.0.0:4096/"))
    if (wildcard !== undefined) expect(wildcard).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:4096$/)
  })
})
