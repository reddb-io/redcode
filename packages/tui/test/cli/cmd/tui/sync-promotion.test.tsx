/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { GlobalEvent } from "@reddb-io/redcode-sdk/v2"
import { tmpdir } from "../../../fixture/fixture"
import { directory, mount, wait } from "./sync-fixture"

function message(sessionID: string, id: string, created: number) {
  return {
    id,
    sessionID,
    role: "user" as const,
    agent: "build",
    model: { providerID: "test", modelID: "test" },
    time: { created },
  }
}
function global(payload: GlobalEvent["payload"]): GlobalEvent {
  return { directory, project: "proj_test", payload }
}

// A promoted prompt arrives as `message.updated` with the id the TUI already holds and a later
// time, so the time+id key misses: the entry has to move, not appear twice.
test("a promoted message moves to its new position instead of being duplicated", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const { app, sync, emit } = await mount(undefined, tmp.path)
  const id = "ses_promoted"
  try {
    emit(global({ id: "evt_a", type: "message.updated", properties: { sessionID: id, info: message(id, "msg_a", 1) } }))
    emit(global({ id: "evt_b", type: "message.updated", properties: { sessionID: id, info: message(id, "msg_b", 2) } }))
    await wait(() => sync.data.message[id]?.length === 2)
    emit(
      global({ id: "evt_a2", type: "message.updated", properties: { sessionID: id, info: message(id, "msg_a", 3) } }),
    )
    await wait(() => sync.data.message[id]?.at(-1)?.id === "msg_a")
    expect(sync.data.message[id].map((item) => item.id)).toEqual(["msg_b", "msg_a"])
    expect(sync.data.message[id].at(-1)?.time.created).toBe(3)
  } finally {
    app.renderer.destroy()
  }
})
