import { expect, test } from "bun:test"
import { Writable } from "node:stream"
import { watchConsoleStreams } from "./console-stream"

test("disables console logging when a pipe fails asynchronously", async () => {
  let disabled = false
  const error = Object.assign(new Error("broken pipe"), { code: "EPIPE" })
  const stream = new Writable({
    write(_chunk, _encoding, callback) {
      queueMicrotask(() => callback(error))
    },
  })
  watchConsoleStreams([stream], () => {
    disabled = true
  })
  const failed = new Promise<void>((resolve) => stream.once("error", () => resolve()))
  stream.write("log message")
  await failed
  expect(disabled).toBe(true)
})

test("preserves handling for other stream errors", () => {
  const stream = new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  })
  watchConsoleStreams([stream], () => {
    throw new Error("unexpected disable")
  })
  const error = Object.assign(new Error("other failure"), { code: "EIO" })
  expect(() => stream.emit("error", error)).toThrow(error)

  let observed: Error | undefined
  stream.on("error", (cause) => {
    observed = cause
  })
  stream.emit("error", error)
  expect(observed).toBe(error)
})
