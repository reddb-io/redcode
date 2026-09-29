/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { disposeAll } from "../../../src/plugin/context"

test("cleanups run newest first and a failure does not stop the rest", async () => {
  const order: string[] = []
  const failure = await disposeAll([
    async () => void order.push("first"),
    async () => {
      order.push("second")
      throw new Error("second failed")
    },
    async () => void order.push("third"),
  ]).then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(order).toEqual(["third", "second", "first"])
  expect(failure).toMatchObject({ message: "second failed" })
})

test("a cleanup that never settles is abandoned at the deadline and the rest still run", async () => {
  const order: string[] = []
  const started = Date.now()
  const failure = await disposeAll(
    [async () => void order.push("older"), () => new Promise<void>(() => order.push("stuck"))],
    50,
  ).then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(Date.now() - started).toBeLessThan(1_000)
  expect(failure).toMatchObject({ message: "Plugin cleanup did not finish within 50 ms" })
  expect(order).toEqual(["stuck", "older"])
})
