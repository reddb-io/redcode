import { describe, expect, test } from "bun:test"
import { forwardedPairingAddress, pairingAddresses } from "./share"

describe("outgoing pairing addresses", () => {
  test("keeps reachable addresses, removes duplicates and prefers HTTPS over local network routes", () => {
    expect(
      pairingAddresses([
        "http://127.0.0.1:49374",
        "http://127.0.0.2:49374",
        "http://LOCALHOST:49374",
        "http://dev.localhost:49374",
        "http://[::1]:49374",
        "http://0.0.0.0:49374",
        "http://[::]:49374",
        "http://192.168.1.2:49374",
        "http://192.168.1.2:49374/",
        "https://remote.example.test/",
        "ftp://remote.example.test",
        "http://user:secret@remote.example.test",
        "https://remote.example.test/?token=secret",
        "https://remote.example.test/prefix",
        "https://remote.example.test/#secret",
      ]),
    ).toEqual(["https://remote.example.test", "http://192.168.1.2:49374"])
    expect(pairingAddresses(["http://localhost:49374"])).toEqual([])
  })

  test("allows an explicitly configured SSH forward without advertising loopback as a network route", () => {
    expect(forwardedPairingAddress("http://127.0.0.1:4096")).toBe("http://127.0.0.1:4096")
    expect(forwardedPairingAddress("https://remote.example.test/")).toBe("https://remote.example.test")
    for (const address of [
      "http://0.0.0.0:4096",
      "http://[::]:4096",
      "https://remote.example.test/prefix",
      "https://remote.example.test/#secret",
      "http://user:secret@remote.example.test",
      "ftp://host",
    ])
      expect(forwardedPairingAddress(address)).toBeUndefined()
  })
})
