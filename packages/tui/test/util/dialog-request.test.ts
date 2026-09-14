import { expect, test } from "bun:test"
import {
  DIALOG_REQUEST_TIMEOUT,
  DialogTimeoutError,
  EXIT_PRESS_WINDOW,
  REMOTE_DIALOG_REQUEST_TIMEOUT,
  classifyDialogFailure,
  createExitPresses,
  dialogRequest,
  dialogTimeout,
  isNotFound,
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

test("a remote server gets a longer timeout than the local worker", () => {
  expect(dialogTimeout("http://opencode.internal")).toBe(DIALOG_REQUEST_TIMEOUT)
  expect(dialogTimeout("https://redcode.example.com")).toBe(REMOTE_DIALOG_REQUEST_TIMEOUT)
})

test("only a not-found error makes a dialog stale; a timeout checks whether the request is still pending", async () => {
  expect(isNotFound({ _tag: "QuestionNotFoundError" })).toBe(true)
  expect(isNotFound({ name: "PermissionNotFoundError" })).toBe(true)
  expect(isNotFound(new Error("Question request not found", { cause: { body: {}, status: 404 } }))).toBe(true)
  expect(isNotFound(new Error("database is locked", { cause: { body: {}, status: 500 } }))).toBe(false)
  expect(await classifyDialogFailure({ _tag: "QuestionNotFoundError" }, async () => true)).toBe("gone")
  expect(await classifyDialogFailure({ name: "UnknownError" }, async () => false)).toBe("failed")
  expect(await classifyDialogFailure(new DialogTimeoutError(), async () => true)).toBe("slow-pending")
  expect(await classifyDialogFailure(new DialogTimeoutError(), async () => false)).toBe("slow-gone")
  expect(await classifyDialogFailure(new DialogTimeoutError(), () => Promise.reject(new DialogTimeoutError()))).toBe(
    "unreachable",
  )
})

test("a repeated exit press counts only for the same key inside the window", () => {
  const presses = createExitPresses()
  expect(presses.press("que_a", 1_000)).toBe(false)
  expect(presses.press("que_b", 1_500)).toBe(false)
  expect(presses.press("que_b", 1_500 + EXIT_PRESS_WINDOW + 1)).toBe(false)
  expect(presses.press("que_b", 1_500 + EXIT_PRESS_WINDOW + 2)).toBe(true)
  expect(presses.press("que_b", 1_500 + EXIT_PRESS_WINDOW + 3)).toBe(false)
  expect(presses.press("que_b", 1_500 + EXIT_PRESS_WINDOW + 2)).toBe(false)
  presses.reset()
  expect(presses.press("que_b", 100_000)).toBe(false)
})
