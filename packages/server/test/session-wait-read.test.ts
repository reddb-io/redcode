import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import type { Bus } from "@opencode/core/bus"
import { Session } from "@opencode/core/session"
import { SessionWait } from "@opencode/core/session/wait"
import { ActiveSessionsResponse } from "@opencode/protocol/groups/session"
import { activeSessions } from "../src/session-read"

test("active session snapshots include current waits and drop them after settlement", async () => {
  const sessionID = Session.ID.make("ses_wait_snapshot")
  const session = { active: Effect.succeed(new Set([sessionID])) } as unknown as Session.Interface
  const bus = { publish: () => Effect.void } as unknown as Pick<Bus.Interface, "publish">
  await Effect.runPromise(
    Effect.gen(function* () {
      const end = yield* SessionWait.start(bus, { sessionID, kind: "model", target: "provider/model" })
      const snapshot = Schema.encodeSync(ActiveSessionsResponse)(yield* activeSessions(session))
      expect(snapshot.data[sessionID]?.waits).toMatchObject([{ kind: "model", target: "provider/model" }])
      yield* end
      const settled = Schema.encodeSync(ActiveSessionsResponse)(yield* activeSessions(session))
      expect(settled.data[sessionID]?.waits).toEqual([])
    }),
  )
})
