import { expect, test } from "bun:test"
import { createVoiceInput } from "./voice-input.js"

test("releases capture before transcription, preserves changed drafts, and retries retained audio", async () => {
  const events: string[] = []
  const result = Promise.withResolvers<string>()
  let draft = "draft"
  let calls = 0
  const voice = createVoiceInput({
    recorder: () => ({
      start: async () => {
        events.push("record")
      },
      stop: async () => {
        events.push("released")
        return new Blob(["audio"])
      },
      cancel: () => events.push("cancel"),
    }),
    read: () => ({ owner: "session-a", revision: draft }),
    prepare: async () => undefined,
    transcribe: async () => {
      events.push("transcribe")
      if (++calls === 1) throw new Error("offline")
      return result.promise
    },
    insert: (text) => {
      draft += text
    },
    change: () => undefined,
  })
  await voice.start()
  expect(voice.busy).toBe(true)
  await voice.finish()
  expect(events).toEqual(["record", "released", "transcribe"])
  expect(voice.state).toMatchObject({ phase: "error", error: "transcription", retry: true })
  const retry = voice.retry()
  draft = "typed while waiting"
  result.resolve("spoken")
  await retry
  expect(draft).toBe("typed while waiting")
  expect(voice.state).toMatchObject({ error: "changed", transcript: "spoken" })
  voice.cancel()
  expect(voice.state).toMatchObject({ phase: "idle", transcript: undefined, retry: false })
})

test.each(["cancel", "owner"] as const)("ignores late transcription after %s", async (action) => {
  const result = Promise.withResolvers<string>()
  const entered = Promise.withResolvers<void>()
  let owner = "a"
  const inserted: string[] = []
  const voice = createVoiceInput({
    recorder: () => ({ start: async () => undefined, stop: async () => new Blob(["audio"]), cancel: () => undefined }),
    read: () => ({ owner, revision: "original" }),
    prepare: async () => undefined,
    transcribe: async (_, signal) => {
      entered.resolve()
      if (action === "cancel")
        signal.addEventListener("abort", () => {
          owner = "cancelled"
        })
      return result.promise
    },
    insert: (text) => inserted.push(text),
    change: () => undefined,
  })
  await voice.start()
  const pending = voice.finish()
  await entered.promise
  if (action === "cancel") voice.cancel()
  if (action === "owner") owner = "b"
  result.resolve("late result")
  await pending
  expect(inserted).toEqual([])
  expect(voice.state.phase).toBe(action === "cancel" ? "idle" : "error")
})

test("late microphone permission cannot cancel a newer recording", async () => {
  const pending = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  const cancelled: number[] = []
  let instance = 0
  const voice = createVoiceInput({
    recorder: () => {
      const id = ++instance
      return {
        start: async () => {
          if (id === 1) {
            started.resolve()
            await pending.promise
          }
        },
        stop: async () => new Blob(),
        cancel: () => {
          cancelled.push(id)
        },
      }
    },
    read: () => ({ owner: "a", revision: "" }),
    prepare: async () => undefined,
    transcribe: async () => "",
    insert: () => undefined,
    change: () => undefined,
  })
  const first = voice.start()
  await started.promise
  voice.cancel()
  await voice.start()
  pending.resolve()
  await first
  expect(voice.state.phase).toBe("recording")
  expect(cancelled).toEqual([1, 1])
  voice.cancel()
})

test("realtime falls back to retained audio and preserves the partial transcript when offline", async () => {
  let update: ((text: string) => void) | undefined
  let calls = 0
  const inserted: string[] = []
  const voice = createVoiceInput({
    recorder: () => ({ start: async () => undefined, stop: async () => new Blob(["audio"]), cancel: () => undefined }),
    read: () => ({ owner: "session-a", revision: "draft" }),
    prepare: async () => ({ token: "single-use", url: "wss://example.invalid" }),
    realtime: (publish) => {
      update = publish
      return { start: async () => undefined, send: () => undefined, finish: async () => ({ text: "partial speech", complete: false }), cancel: () => undefined, text: "partial speech" }
    },
    transcribe: async () => { if (++calls === 1) throw new Error("offline"); return "complete speech" },
    insert: (text) => inserted.push(text),
    change: () => undefined,
  })
  await voice.start()
  update?.("partial speech")
  expect(voice.state.live).toBe("partial speech")
  await voice.finish()
  expect(voice.state).toMatchObject({ phase: "error", transcript: "partial speech", retry: true })
  expect(inserted).toEqual([])
  await voice.retry()
  expect(inserted).toEqual(["complete speech"])
  expect(voice.state.phase).toBe("idle")
})

test("realtime never inserts a transcript into a changed draft", async () => {
  let owner = "first"
  const inserted: string[] = []
  const voice = createVoiceInput({
    recorder: () => ({ start: async () => undefined, stop: async () => new Blob(["audio"]), cancel: () => undefined }),
    read: () => ({ owner, revision: "draft" }),
    prepare: async () => ({ token: "single-use", url: "wss://example.invalid" }),
    realtime: () => ({ start: async () => undefined, send: () => undefined, finish: async () => ({ text: "spoken", complete: true }), cancel: () => undefined, text: "spoken" }),
    transcribe: async () => { throw new Error("unexpected batch fallback") },
    insert: (text) => inserted.push(text), change: () => undefined,
  })
  await voice.start()
  owner = "second"
  await voice.finish()
  expect(inserted).toEqual([])
  expect(voice.state).toMatchObject({ error: "changed", transcript: "spoken" })
})

test("a late realtime connection cannot cancel the next recording", async () => {
  const pending = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  const cancelled: number[] = []
  let instance = 0
  const voice = createVoiceInput({
    recorder: () => ({ start: async () => undefined, stop: async () => new Blob(), cancel: () => undefined }),
    read: () => ({ owner: "a", revision: "" }),
    prepare: async () => ({ token: "one-use", url: "wss://example.invalid" }),
    realtime: () => {
      const id = ++instance
      return {
        start: async () => { if (id === 1) { started.resolve(); await pending.promise } },
        send: () => undefined, finish: async () => ({ text: "", complete: false }),
        cancel: () => { cancelled.push(id) }, text: "",
      }
    },
    transcribe: async () => "", insert: () => undefined, change: () => undefined,
  })
  const first = voice.start()
  await started.promise
  voice.cancel()
  await voice.start()
  pending.resolve()
  await first
  expect(voice.state.phase).toBe("recording")
  expect(cancelled).toEqual([1, 1])
  voice.cancel()
})
