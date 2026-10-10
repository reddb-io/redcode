import { serverAddress } from "./pairing"

/** Addresses another device can use; a wildcard or loopback address belongs to this computer only. */
export function pairingAddresses(values: ReadonlyArray<string>) {
  return [
    ...new Set(
      values.flatMap((value) => {
        const address = serverAddress(value)
        if (!address) return []
        const url = new URL(address)
        if (url.pathname !== "/") return []
        const host = url.hostname.toLowerCase()
        if (
          host === "localhost" ||
          host.endsWith(".localhost") ||
          host.startsWith("127.") ||
          host === "[::1]" ||
          host === "0.0.0.0" ||
          host === "[::]"
        )
          return []
        return [address]
      }),
    ),
  ].sort((left, right) => Number(right.startsWith("https:")) - Number(left.startsWith("https:")))
}

/** An explicit SSH forward can use loopback on the connecting device. */
export function forwardedPairingAddress(value: string) {
  const address = serverAddress(value)
  if (!address) return
  const url = new URL(address)
  if (url.pathname !== "/" || url.hostname === "0.0.0.0" || url.hostname === "[::]") return
  return address
}
