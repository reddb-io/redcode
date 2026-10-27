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
