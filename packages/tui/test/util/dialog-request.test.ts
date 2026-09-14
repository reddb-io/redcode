import { expect, test } from "bun:test"
import {
  DialogTimeoutError,
  EXIT_PRESS_WINDOW,
  dialogRequest,
  repeatedExitPress,
} from "../../src/util/dialog-request"

test("a dialog request the server never answers fails with a timeout and aborts its signal", async () => {
  let signal: AbortSignal | undefined
  const error = await dialogRequest((next) => {
    signal = next
    return new Promise<never>(() => {})
  }, 20).catch((error: unknown) => error)
  expect(error).toBeInstanceOf(DialogTimeoutError)
  expect(signal?.aborted).toBe(true)
})

test("a dialog request that answers in time keeps its result", async () => {
  expect(await dialogRequest(async () => "ok", 1000)).toBe("ok")
})

test("only a repeated exit press inside the window counts", () => {
  const start = 1_000_000
  expect(repeatedExitPress(start)).toBe(false)
  expect(repeatedExitPress(start + EXIT_PRESS_WINDOW + 1)).toBe(false)
  expect(repeatedExitPress(start + EXIT_PRESS_WINDOW + 2)).toBe(true)
  expect(repeatedExitPress(start + EXIT_PRESS_WINDOW + 3)).toBe(false)
})
