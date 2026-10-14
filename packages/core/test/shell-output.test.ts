import { expect, test } from "bun:test"
import { Effect, Schedule, Stream } from "effect"
import { Writable } from "node:stream"
import { writeOutput } from "../src/shell/output"

test("shell capture stops reading while the output file is backpressured", async () => {
  const first = Promise.withResolvers<void>()
  const drain = Promise.withResolvers<void>()
  const chunk = Buffer.alloc(64 * 1024, 120)
  let reads = 0
  let written = 0
  const output = new Writable({
    highWaterMark: chunk.length,
    write(bytes, _encoding, callback) {
      written += bytes.length
      first.resolve()
      void drain.promise.then(() => callback())
    },
  })
  const capture = Effect.runPromise(
    writeOutput(
      Stream.fromEffect(Effect.succeed(chunk)).pipe(Stream.repeat(Schedule.recurs(31))),
      output,
      () => reads++,
    ),
  )

  try {
    await first.promise
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
    expect(reads).toBeLessThanOrEqual(1)
    expect(output.writableLength).toBeLessThanOrEqual(chunk.length)
  } finally {
    drain.resolve()
    await capture
  }
  expect(written).toBe(32 * chunk.length)
  expect(reads).toBe(32)
  expect(output.writableFinished).toBeTrue()
})

test("shell capture settles and releases its writer when the output file fails", async () => {
  const failure = new Error("output disk unavailable")
  const output = new Writable({
    write(_bytes, _encoding, callback) {
      callback(failure)
    },
  })
  const result = Effect.runPromise(writeOutput(Stream.succeed(Buffer.from("output")), output, () => {}))
  await expect(result).rejects.toThrow("output disk unavailable")
  expect(output.destroyed).toBeTrue()
})
