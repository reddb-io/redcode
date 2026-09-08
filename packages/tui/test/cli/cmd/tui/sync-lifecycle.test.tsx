/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { GlobalEvent, PermissionRequest, QuestionRequest } from "@reddb-io/redcode-sdk/v2"
import { createSignal, Show } from "solid-js"
import { SESSION_CACHE_LIMIT, useSessionHistory } from "../../../../src/context/sync"
import { tmpdir } from "../../../fixture/fixture"
import { directory, json, mount, wait } from "./sync-fixture"

function session(id: string) {
  return {
    id,
    slug: id,
    projectID: "proj_test",
    title: id,
    time: { created: 0, updated: 0 },
    version: "test",
    directory,
  }
}
function message(sessionID: string, id = `msg_${sessionID}`) {
  return {
    id,
    sessionID,
    role: "user" as const,
    agent: "build",
    model: { providerID: "test", modelID: "test" },
    time: { created: 1 },
  }
}
function payload(sessionID: string, text: string) {
  const info = message(sessionID)
  return [{ info, parts: [{ id: `prt_${sessionID}`, sessionID, messageID: info.id, type: "text", text }] }]
}
function global(payload: GlobalEvent["payload"]): GlobalEvent {
  return { directory, project: "proj_test", payload }
}
function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function pending(sessionID: string) {
  return {
    permission: {
      id: "per_pending",
      sessionID,
      permission: "bash",
      patterns: ["echo test"],
      always: [],
      metadata: {},
    } satisfies PermissionRequest,
    question: {
      id: "que_pending",
      sessionID,
      questions: [{ question: "Continue?", header: "Continue", options: [{ label: "Yes", description: "Continue" }] }],
    } satisfies QuestionRequest,
  }
}

test("session deletion releases every cache, including orphan parts and late hydration", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const gate = deferred()
  const id = "ses_deleted"
  const { app, sync, emit } = await mount((url) => {
    if (url.pathname === `/session/${id}`) return json(session(id))
    if (url.pathname === `/session/${id}/message`) return gate.promise
    if (url.pathname.startsWith(`/session/${id}/`)) return json([])
  }, tmp.path)
  try {
    const hydrate = sync.session.sync(id)
    emit(global({ id: "evt_session", type: "session.updated", properties: { sessionID: id, info: session(id) } }))
    emit(global({ id: "evt_message", type: "message.updated", properties: { sessionID: id, info: message(id) } }))
    emit(
      global({
        id: "evt_part",
        type: "message.part.updated",
        properties: {
          sessionID: id,
          time: 1,
          part: { id: "prt_orphan", sessionID: id, messageID: "msg_orphan", type: "text", text: "orphan" },
        },
      }),
    )
    emit(global({ id: "evt_todo", type: "todo.updated", properties: { sessionID: id, todos: [] } }))
    emit(global({ id: "evt_status", type: "session.status", properties: { sessionID: id, status: { type: "busy" } } }))
    emit(global({ id: "evt_permission", type: "permission.asked", properties: pending(id).permission }))
    emit(global({ id: "evt_question", type: "question.asked", properties: pending(id).question }))
    await wait(() => !!sync.data.part.msg_orphan)
    emit(global({ id: "evt_delete", type: "session.deleted", properties: { sessionID: id, info: session(id) } }))
    await wait(() => !sync.data.part.msg_orphan)
    gate.resolve(json(payload(id, "late snapshot")))
    await hydrate
    expect(sync.session.get(id)).toBeUndefined()
    for (const cache of [
      sync.data.message,
      sync.data.todo,
      sync.data.session_diff,
      sync.data.session_status,
      sync.data.permission,
      sync.data.question,
    ])
      expect(cache[id]).toBeUndefined()
    expect(Object.keys(sync.data.part)).toEqual([])
    emit(
      global({
        id: "evt_late_part",
        type: "message.part.updated",
        properties: {
          sessionID: id,
          time: 3,
          part: { id: "prt_late", sessionID: id, messageID: message(id).id, type: "text", text: "already deleted" },
        },
      }),
    )
    await Bun.sleep(30)
    expect(Object.keys(sync.data.part)).toEqual([])
  } finally {
    app.renderer.destroy()
  }
})

test("inactive caches are bounded while a retained session stays available", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const { app, sync, emit } = await mount(undefined, tmp.path)
  const release = sync.session.retain("ses_pinned")
  try {
    for (const id of ["ses_pinned", ...Array.from({ length: 100 }, (_, i) => `ses_${String(i).padStart(3, "0")}`)]) {
      emit(global({ id: `evt_${id}`, type: "message.updated", properties: { sessionID: id, info: message(id) } }))
      emit(
        global({
          id: `evt_part_${id}`,
          type: "message.part.updated",
          properties: {
            sessionID: id,
            time: 1,
            part: { id: `prt_${id}`, sessionID: id, messageID: message(id).id, type: "text", text: "x".repeat(10000) },
          },
        }),
      )
    }
    await wait(() => !!sync.data.part.msg_ses_099)
    expect(Object.keys(sync.data.message)).toHaveLength(SESSION_CACHE_LIMIT + 1)
    expect(Object.keys(sync.data.part)).toHaveLength(SESSION_CACHE_LIMIT + 1)
    expect(sync.data.message.ses_pinned).toHaveLength(1)
    release()
    expect(Object.keys(sync.data.message)).toHaveLength(SESSION_CACHE_LIMIT)
    expect(sync.data.message.ses_pinned).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("reconnect refreshes transcript and recovers pending permissions and questions", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const id = "ses_reconnect"
  let latest = "before gap"
  let reads = 0
  let disconnected = false
  const { app, sync } = await mount((url) => {
    if (url.pathname === `/session/${id}`) return json(session(id))
    if (url.pathname === `/session/${id}/message`) {
      reads++
      return json(payload(id, latest))
    }
    if (url.pathname.startsWith(`/session/${id}/`)) return json([])
    if (url.pathname === "/permission") return json(disconnected ? [pending(id).permission] : [])
    if (url.pathname === "/question") return json(disconnected ? [pending(id).question] : [])
  }, tmp.path)
  try {
    await sync.session.sync(id)
    latest = "finished during gap"
    disconnected = true
    await sync.bootstrap({ fatal: false })
    await sync.session.sync(id)
    expect(reads).toBe(2)
    expect(sync.data.part[`msg_${id}`][0]).toMatchObject({ text: latest })
    expect(sync.data.permission[id]).toEqual([pending(id).permission])
    expect(sync.data.question[id]).toEqual([pending(id).question])
  } finally {
    app.renderer.destroy()
  }
})

test("a previous connection generation cannot overwrite a newer transcript", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const id = "ses_generations"
  const stale = deferred()
  let reads = 0
  const { app, sync } = await mount((url) => {
    if (url.pathname === `/session/${id}`) return json(session(id))
    if (url.pathname === `/session/${id}/message`) {
      reads++
      return reads === 1 ? stale.promise : json(payload(id, "new generation"))
    }
    if (url.pathname.startsWith(`/session/${id}/`)) return json([])
  }, tmp.path)
  try {
    const old = sync.session.sync(id)
    await wait(() => reads === 1)
    await sync.bootstrap({ fatal: false })
    stale.resolve(json(payload(id, "stale generation")))
    await old
    expect(sync.data.part[`msg_${id}`][0]).toMatchObject({ text: "new generation" })
  } finally {
    app.renderer.destroy()
  }
})

test("recovery snapshots do not restore answered interactions or replace live session state", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const id = "ses_snapshot_race"
  const stale = deferred()
  let recovering = false
  let requested = false
  const { app, sync, emit } = await mount((url) => {
    if (url.pathname === "/permission") {
      if (!recovering) return json([pending(id).permission])
      requested = true
      return stale.promise
    }
    if (url.pathname === "/question") return json([pending(id).question])
    if (url.pathname === "/session/status") return json({ [id]: { type: "busy" } })
    if (url.pathname === "/session") return json([session(id)])
  }, tmp.path)
  try {
    recovering = true
    const recovery = sync.bootstrap({ fatal: false })
    await wait(() => requested)
    emit(
      global({
        id: "evt_reply",
        type: "permission.replied",
        properties: { sessionID: id, requestID: pending(id).permission.id, reply: "once" },
      }),
    )
    emit(
      global({
        id: "evt_answer",
        type: "question.rejected",
        properties: { sessionID: id, requestID: pending(id).question.id },
      }),
    )
    emit(global({ id: "evt_idle", type: "session.status", properties: { sessionID: id, status: { type: "idle" } } }))
    emit(
      global({
        id: "evt_rename",
        type: "session.updated",
        properties: { sessionID: id, info: { ...session(id), title: "live title" } },
      }),
    )
    await wait(() => sync.data.session_status[id]?.type === "idle")
    stale.resolve(json([pending(id).permission]))
    await recovery
    expect(sync.data.permission[id] ?? []).toEqual([])
    expect(sync.data.question[id] ?? []).toEqual([])
    expect(sync.data.session_status[id]).toEqual({ type: "idle" })
    expect(sync.session.get(id)?.title).toBe("live title")
  } finally {
    app.renderer.destroy()
  }
})

test("late parts cannot recreate evicted or removed message caches", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const id = "ses_late_parts"
  const { app, sync, emit } = await mount(undefined, tmp.path)
  try {
    for (let index = 0; index < 101; index++) {
      const info = { ...message(id, `msg_${String(index).padStart(3, "0")}`), time: { created: 1000000000000 + index } }
      emit(global({ id: `evt_${index}`, type: "message.updated", properties: { sessionID: id, info } }))
    }
    await wait(() => sync.data.message[id]?.length === 100)
    emit(
      global({
        id: "evt_late",
        type: "message.part.updated",
        properties: {
          sessionID: id,
          time: 1,
          part: { id: "prt_old", sessionID: id, messageID: "msg_000", type: "text", text: "evicted" },
        },
      }),
    )
    emit(global({ id: "evt_remove", type: "message.removed", properties: { sessionID: id, messageID: "msg_001" } }))
    emit(
      global({
        id: "evt_late_removed",
        type: "message.part.updated",
        properties: {
          sessionID: id,
          time: 2,
          part: { id: "prt_removed", sessionID: id, messageID: "msg_001", type: "text", text: "removed" },
        },
      }),
    )
    await wait(() => sync.data.message[id]?.length === 99)
    expect(sync.data.part.msg_000).toBeUndefined()
    expect(sync.data.part.msg_001).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("continue becomes usable and recovers interactions while an optional LSP read is pending", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const id = "ses_continue"
  const lsp = deferred()
  const { app, sync } = await mount(
    (url) => {
      if (url.pathname === "/session") return json([session(id)])
      if (url.pathname === "/permission") return json([pending(id).permission])
      if (url.pathname === "/lsp") return lsp.promise
    },
    tmp.path,
    undefined,
    { continue: true, ready: "partial" },
  )
  try {
    await wait(() => !!sync.data.permission[id]?.length)
    expect(sync.ready).toBe(true)
    expect(sync.session.get(id)?.id).toBe(id)
    expect(sync.status).toBe("partial")
    lsp.resolve(json([]))
    await wait(() => sync.status === "complete")
  } finally {
    lsp.resolve(json([]))
    app.renderer.destroy()
  }
})

test.each(["refresh", "bootstrap"])("a delayed session list cannot replace a newer %s", async (recovery) => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const old = deferred()
  let reads = 0
  const { app, sync } = await mount((url) => {
    if (url.pathname !== "/session") return
    reads++
    if (reads === 2) return old.promise
    return json(reads === 1 ? [session("ses_a")] : [session("ses_b")])
  }, tmp.path)
  try {
    const stale = sync.session.refresh()
    await wait(() => reads === 2)
    await (recovery === "refresh" ? sync.session.refresh() : sync.bootstrap({ fatal: false }))
    old.resolve(json([session("ses_a")]))
    await stale
    expect(sync.data.session.map((session) => session.id)).toEqual(["ses_b"])
  } finally {
    app.renderer.destroy()
  }
})

test("a session removed while its list is loading is not resurrected by the response", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const id = "ses_list_deleted"
  const old = deferred()
  let reads = 0
  const { app, sync, emit } = await mount((url) => {
    if (url.pathname !== "/session") return
    reads++
    return reads === 1 ? json([session(id)]) : old.promise
  }, tmp.path)
  try {
    const refresh = sync.session.refresh()
    await wait(() => reads === 2)
    emit(global({ id: "evt_list_deleted", type: "session.deleted", properties: { sessionID: id, info: session(id) } }))
    await wait(() => sync.data.session.length === 0)
    old.resolve(json([session(id)]))
    await refresh
    expect(sync.data.session).toEqual([])
  } finally {
    app.renderer.destroy()
  }
})

test("mounted Task history retains a late session ID without refetch loops and releases it on disposal", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const [id, setID] = createSignal<string>()
  const [shown, setShown] = createSignal(true)
  let reads = 0
  function Consumer() {
    useSessionHistory(id)
    return <box />
  }
  const { app, sync, emit } = await mount(
    (url) => {
      if (url.pathname === "/session/ses_child") return json(session("ses_child"))
      if (url.pathname === "/session/ses_child/message") {
        reads++
        return json(payload("ses_child", "retained Task detail"))
      }
      if (url.pathname.startsWith("/session/ses_child/")) return json([])
    },
    tmp.path,
    () => (
      <Show when={shown()}>
        <Consumer />
      </Show>
    ),
  )
  try {
    expect(reads).toBe(0)
    setID("ses_child")
    await wait(() => !!sync.data.message.ses_child?.length)
    for (let index = 0; index < 40; index++) {
      const sessionID = `ses_background_${index}`
      emit(
        global({
          id: `evt_background_${index}`,
          type: "message.updated",
          properties: { sessionID, info: message(sessionID) },
        }),
      )
    }
    await wait(() => !!sync.data.message.ses_background_39)
    expect(reads).toBe(1)
    expect(sync.data.part.msg_ses_child[0]).toMatchObject({ text: "retained Task detail" })
    expect(Object.keys(sync.data.message)).toHaveLength(SESSION_CACHE_LIMIT + 1)
    setShown(false)
    expect(sync.data.message.ses_child).toBeUndefined()
    expect(Object.keys(sync.data.message)).toHaveLength(SESSION_CACHE_LIMIT)
  } finally {
    app.renderer.destroy()
  }
})
