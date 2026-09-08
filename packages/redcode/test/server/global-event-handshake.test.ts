import { expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { GlobalBus } from "@/bus/global"
import { eventResponse } from "@/server/routes/instance/httpapi/handlers/global"

test("global events subscribe before the response body starts and release on disconnect", async () => {
  const before = GlobalBus.listenerCount("event")
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const response = yield* eventResponse()
        expect(GlobalBus.listenerCount("event")).toBe(before + 1)
        GlobalBus.emit("event", {
          directory: "global",
          payload: { type: "server.test.handshake", properties: { text: "published-before-body" } },
        })
        if (response.body._tag !== "Stream") throw new Error("Expected an SSE response stream")
        const text = yield* response.body.stream.pipe(
          Stream.decodeText(),
          Stream.takeUntil((chunk) => chunk.includes("published-before-body")),
          Stream.mkString,
          Effect.timeout("2 seconds"),
        )
        expect(text).toContain("server.connected")
        expect(text).toContain("published-before-body")
      }),
    ),
  )
  expect(GlobalBus.listenerCount("event")).toBe(before)
}, 30000)

test("abandoning a global response before consuming its body releases the subscription", async () => {
  const before = GlobalBus.listenerCount("event")
  await Effect.runPromise(Effect.scoped(eventResponse()))
  expect(GlobalBus.listenerCount("event")).toBe(before)
}, 30000)
