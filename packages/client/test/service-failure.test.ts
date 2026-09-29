import { expect, test } from "bun:test"
import { decodeFailure, failedToStart } from "../src/service-failure"

test("keeps the plain message when the service reports no reason", () => {
  expect(failedToStart()).toBe("Background service failed to start")
  expect(failedToStart({})).toBe("Background service failed to start")
})

test("explains a failed start with its reason, log and recovery command", () => {
  expect(
    failedToStart({
      message: "Managed service port 49373 on 127.0.0.1 is already in use by another process.",
      log: "/home/user/.local/share/opencode/log/opencode.log",
    }),
  ).toBe(
    [
      "Background service failed to start: Managed service port 49373 on 127.0.0.1 is already in use by another process.",
      "Details are in /home/user/.local/share/opencode/log/opencode.log",
      "Run `redcode service restart` after fixing the cause.",
    ].join("\n"),
  )
  expect(failedToStart({ log: "/tmp/opencode.log" })).toBe(
    [
      "Background service failed to start",
      "Details are in /tmp/opencode.log",
      "Run `redcode service restart` after fixing the cause.",
    ].join("\n"),
  )
})

test("reads only well-formed failure details", () => {
  expect(decodeFailure({ failure: { message: "boom", log: "/tmp/opencode.log" } })).toEqual({
    message: "boom",
    log: "/tmp/opencode.log",
  })
  expect(decodeFailure({ failure: { message: 1, log: "/tmp/opencode.log" } })).toEqual({
    message: undefined,
    log: "/tmp/opencode.log",
  })
  expect(decodeFailure({ version: "test" })).toBeUndefined()
  expect(decodeFailure({ failure: null })).toBeUndefined()
  expect(decodeFailure(undefined)).toBeUndefined()
})
