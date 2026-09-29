import { expect, test } from "bun:test"
import { PassThrough } from "node:stream"
import { readStdinWithin } from "../src/util/io"

test("reads a pipe to EOF when data starts before the deadline", async () => {
  const stream = new PassThrough()
  const read = readStdinWithin(200, stream)
  stream.write("first ")
  // The rest arrives after the deadline; once data flows the pipe is read in full.
  setTimeout(() => stream.end("second"), 400)
  expect(await read).toBe("first second")
})

test("returns an empty string for a pipe that closes without data", async () => {
  const stream = new PassThrough()
  const read = readStdinWithin(200, stream)
  stream.end()
  expect(await read).toBe("")
})

test("stops waiting for a pipe that never sends data nor closes", async () => {
  const stream = new PassThrough()
  expect(await readStdinWithin(50, stream)).toBeUndefined()
  expect(stream.destroyed).toBe(true)
})
