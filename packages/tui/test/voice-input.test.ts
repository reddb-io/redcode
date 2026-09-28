import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { connect } from "node:net"
import { createInterface } from "node:readline"
import { createVoiceInputHandler, startVoiceInputSink } from "../src/context/voice-input"
import { emptyPrompt } from "../src/prompt/history"

test.skipIf(process.platform === "win32")(
  "voice socket preserves a draft, replaces partials, cancels, and rejects invalid events",
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "redcode-voice-"))
    const state = {
      value: {
        ...emptyPrompt(),
        text: "Explain this:",
        pasted: [{ text: "source", source: { start: 0, end: 6, text: "source" } }],
      },
    }
    const original = structuredClone(state.value)
    const cleanup = startVoiceInputSink(
      createVoiceInputHandler(() => ({
        get current() {
          return state.value
        },
        set(value) {
          state.value = value
        },
      })),
      directory,
    )
    const registry = JSON.parse(await readFile(path.join(directory, `${process.pid}.json`), "utf8"))
    const socket = connect(registry.socket)
    const lines = createInterface({ input: socket })[Symbol.asyncIterator]()
    const send = async (event: string, text?: string) => {
      socket.write(JSON.stringify({ version: 1, token: registry.token, dictation_id: "dictation", event, text }) + "\n")
      return JSON.parse((await lines.next()).value!)
    }
    try {
      socket.write("null\n")
      expect(JSON.parse((await lines.next()).value!).ok).toBe(false)
      expect((await send("start")).ok).toBe(true)
      await send("partial", "first guess")
      await send("partial", "better guess")
      expect(state.value.text).toBe("Explain this: better guess")
      await send("cancel")
      expect(state.value).toEqual(original)
      await send("start")
      await send("commit", "a tree")
      await send("partial", "unconfirmed words")
      await send("finish")
      expect(state.value.text).toBe("Explain this: a tree")
      expect(state.value.pasted).toEqual(original.pasted)
      await send("start")
      state.value.text = "User edited this"
      expect((await send("commit", "do not replace")).error).toBe("composer_changed")
      expect(state.value.text).toBe("User edited this")
    } finally {
      socket.destroy()
      cleanup()
      await rm(directory, { recursive: true, force: true })
    }
  },
)
