import { expect, test } from "bun:test"
import { parseInvitation } from "../src/workers/enrollment"

test("worker invitations accept LAN, IPv6 and HTTPS addresses without credentials or query tokens", () => {
  const code = "a".repeat(43)
  for (const origin of ["http://192.168.1.4:35555", "http://[fd00::1]:35555", "https://redcode.example.com"]) {
    expect(parseInvitation(`${origin}/auth/worker#${code}`)).toEqual({ coordinator: origin, code })
  }
  for (const link of [
    `https://admin:secret@host/auth/worker#${code}`,
    `https://host/auth/worker?code=${code}`,
    `https://host/auth/connect#${code}`,
    `file:///auth/worker#${code}`,
    "https://host/auth/worker#short",
  ])
    expect(() => parseInvitation(link)).toThrow("invitation link")
})
