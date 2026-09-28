import { chmodSync, mkdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { onCleanup, onMount, type JSX } from "solid-js"
import { unwrap } from "solid-js/store"
import { Option, Schema } from "effect"
import type { PromptRef } from "../component/prompt"
import type { PromptInfo } from "../prompt/history"
import { usePromptRef } from "./prompt"

const VoiceInputEvent = Schema.Struct({
  version: Schema.Literal(1),
  token: Schema.String,
  dictation_id: Schema.String,
  event: Schema.Literals(["start", "partial", "commit", "finish", "cancel"]),
  text: Schema.String.pipe(Schema.optional),
})
type VoiceInputEvent = typeof VoiceInputEvent.Type
const decodeJSON = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
const decodeEvent = Schema.decodeUnknownOption(VoiceInputEvent)

type VoiceDraft = {
  dictationID: string
  original: PromptInfo
  committed: string
  rendered: string
}

type SocketData = { buffer: string; decoder: TextDecoder }

export function VoiceInputProvider(props: { children: JSX.Element }) {
  const prompt = usePromptRef()
  onMount(() => {
    if (process.platform === "win32") return
    try {
      onCleanup(startVoiceInputSink(createVoiceInputHandler(() => prompt.current)))
    } catch (error) {
      console.warn("voice input sink unavailable", error)
    }
  })
  return props.children
}

export function createVoiceInputHandler(prompt: () => Pick<PromptRef, "current" | "set"> | undefined) {
  let draft: VoiceDraft | undefined
  return (event: VoiceInputEvent) => {
    const current = prompt()
    if (!current) return { ok: false, error: "composer_unavailable" }
    if (event.event === "start") {
      draft = {
        dictationID: event.dictation_id,
        original: structuredClone(unwrap(current.current)),
        committed: "",
        rendered: current.current.text,
      }
      return { ok: true }
    }
    if (!draft || draft.dictationID !== event.dictation_id) return { ok: false, error: "dictation_not_active" }
    if (current.current.text !== draft.rendered) {
      draft = undefined
      return { ok: false, error: "composer_changed" }
    }
    if (event.event === "cancel") {
      current.set(draft.original)
      draft = undefined
      return { ok: true }
    }
    if (event.event === "finish") {
      current.set({ ...draft.original, text: appendVoiceText(draft.original.text, draft.committed) })
      draft = undefined
      return { ok: true }
    }
    if (event.event === "commit") draft.committed = appendVoiceText(draft.committed, event.text ?? "")
    draft.rendered = appendVoiceText(
      draft.original.text,
      draft.committed,
      event.event === "partial" ? (event.text ?? "") : "",
    )
    current.set({ ...draft.original, text: draft.rendered })
    return { ok: true }
  }
}

export function startVoiceInputSink(
  handle: (event: VoiceInputEvent) => { ok: boolean; error?: string },
  directory = path.join(
    process.env.XDG_RUNTIME_DIR || "/tmp",
    `redcode-${process.getuid?.() ?? "user"}`,
    "voice-input",
  ),
) {
  const socketPath = path.join(directory, `${process.pid}.sock`)
  const registryPath = path.join(directory, `${process.pid}.json`)
  const token = crypto.randomUUID()

  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  rmSync(socketPath, { force: true })

  const server = Bun.listen<SocketData>({
    unix: socketPath,
    socket: {
      open(socket) {
        socket.data = { buffer: "", decoder: new TextDecoder() }
      },
      data(socket, bytes) {
        socket.data.buffer += socket.data.decoder.decode(bytes, { stream: true })
        const lines = socket.data.buffer.split("\n")
        socket.data.buffer = lines.pop() ?? ""
        lines.forEach((line) => {
          if (!line.trim()) return
          const result = parseVoiceInputEvent(line, token)
          if (!result.ok) {
            socket.write(`${JSON.stringify(result)}\n`)
            return
          }
          socket.write(`${JSON.stringify(handle(result.event))}\n`)
        })
      },
      error(_, error) {
        console.error("voice input socket error", error)
      },
    },
  })

  try {
    chmodSync(socketPath, 0o600)
    writeFileSync(
      registryPath,
      JSON.stringify({
        version: 1,
        pid: process.pid,
        socket: socketPath,
        token,
        tty: terminalPath(),
        zellij_session: process.env.ZELLIJ_SESSION_NAME,
        zellij_pane: process.env.ZELLIJ_PANE_ID,
      }),
      { mode: 0o600 },
    )
  } catch (error) {
    server.stop(true)
    rmSync(socketPath, { force: true })
    rmSync(registryPath, { force: true })
    throw error
  }

  return () => {
    server.stop(true)
    rmSync(socketPath, { force: true })
    rmSync(registryPath, { force: true })
  }
}

function parseVoiceInputEvent(
  input: string,
  token: string,
): { ok: true; event: VoiceInputEvent } | { ok: false; error: string } {
  const json = decodeJSON(input)
  if (Option.isNone(json)) return { ok: false, error: "invalid_json" }
  const decoded = decodeEvent(json.value)
  if (Option.isNone(decoded) || decoded.value.token !== token) return { ok: false, error: "invalid_request" }
  const event = decoded.value
  if ((event.event === "partial" || event.event === "commit") && event.text === undefined)
    return { ok: false, error: "invalid_request" }
  return { ok: true, event }
}

function appendVoiceText(base: string, ...values: string[]) {
  const spoken = values
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ")
  if (!spoken) return base
  if (!base) return spoken
  return `${base}${/\s$/.test(base) ? "" : " "}${spoken}`
}

function terminalPath() {
  if (process.platform !== "linux") return
  try {
    return readlinkSync("/proc/self/fd/0")
  } catch {
    return
  }
}
