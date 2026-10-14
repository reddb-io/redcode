import { afterEach, describe, expect, test } from "bun:test"
import { uuid } from "./uuid.js"

const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto")

const secureDescriptor = Object.getOwnPropertyDescriptor(globalThis, "isSecureContext")

const randomDescriptor = Object.getOwnPropertyDescriptor(Math, "random")

const setCrypto = (value: Partial<Crypto>) => {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: value as Crypto,
  })
}

const setSecure = (value: boolean) => {
  Object.defineProperty(globalThis, "isSecureContext", {
    configurable: true,
    value,
  })
}

const setRandom = (value: () => number) => {
  Object.defineProperty(Math, "random", {
    configurable: true,
    value,
  })
}

afterEach(() => {
  if (cryptoDescriptor) {
    Object.defineProperty(globalThis, "crypto", cryptoDescriptor)
  }

  if (secureDescriptor) {
    Object.defineProperty(globalThis, "isSecureContext", secureDescriptor)
  }

  if (!secureDescriptor) {
    delete (globalThis as { isSecureContext?: boolean }).isSecureContext
  }

  if (randomDescriptor) {
    Object.defineProperty(Math, "random", randomDescriptor)
  }
})

describe("uuid", () => {
  test("uses randomUUID in secure contexts", () => {
    setCrypto({ randomUUID: () => "00000000-0000-0000-0000-000000000000" })
    setSecure(true)
    expect(uuid()).toBe("00000000-0000-0000-0000-000000000000")
  })

  const fallbacks: {
    name: string
    secure: boolean
    crypto: Partial<Crypto>
  }[] = [
    {
      name: "in insecure contexts",
      secure: false,
      crypto: { randomUUID: () => "00000000-0000-0000-0000-000000000000" },
    },
    {
      name: "when randomUUID throws",
      secure: true,
      crypto: {
        randomUUID: () => {
          throw new DOMException("Failed", "OperationError")
        },
      },
    },
    { name: "when randomUUID is unavailable", secure: true, crypto: {} },
  ]

  test.each(fallbacks)("falls back $name", (row) => {
    setCrypto(row.crypto)
    setSecure(row.secure)
    setRandom(() => 0.5)
    expect(uuid()).toBe("8")
  })

  test("uses random bytes for UUIDs on LAN HTTP without randomUUID", () => {
    setCrypto({ getRandomValues: crypto.getRandomValues.bind(crypto) })
    setSecure(false)
    setRandom(() => 0)
    const ids = Array.from({ length: 100 }, () => uuid())
    expect(ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(
      true,
    )
    expect(new Set(ids).size).toBe(ids.length)
  })
})
