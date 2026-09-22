import { chmodSync, mkdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { onCleanup, onMount, type JSX } from "solid-js"
import type { PromptInfo } from "../prompt/history"
import { usePromptRef } from "./prompt"

type VoiceInputEvent =
  | { version: 1; token: string; dictation_id: string; event: "start" }
  | { version: 1; token: string; dictation_id: string; event: "partial" | "commit"; text: string }
  | { version: 1; token: string; dictation_id: string; event: "finish" | "cancel" }

type VoiceDraft = {
  dictationID: string
  original: PromptInfo
  committed: string
  rendered: string
}

type SocketData = { buffer: string; decoder: TextDecoder }

export function VoiceInputProvider(props: { children: JSX.Element }) {
  const prompt = usePromptRef()
  let draft: VoiceDraft | undefined

  onMount(() => {
    if (process.platform === "win32") return
    try {
      const cleanup = startVoiceInputSink((event) => {
        const current = prompt.current
        if (!current) return { ok: false, error: "composer_unavailable" }
        if (event.event === "start") {
          draft = {
            dictationID: event.dictation_id,
            original: { ...current.current, parts: [...current.current.parts] },
            committed: "",
            rendered: current.current.input,
          }
          return { ok: true }
        }
        if (!draft || draft.dictationID !== event.dictation_id) {
          return { ok: false, error: "dictation_not_active" }
        }
        if (current.current.input !== draft.rendered) {
          draft = undefined
          return { ok: false, error: "composer_changed" }
        }
        if (event.event === "cancel") {
          current.set(draft.original)
          draft = undefined
          return { ok: true }
        }
        if (event.event === "finish") {
          current.set({ ...draft.original, input: appendVoiceText(draft.original.input, draft.committed) })
          draft = undefined
          return { ok: true }
        }
        if (event.event === "commit") draft.committed = appendVoiceText(draft.committed, event.text)
        const partial = event.event === "partial" ? event.text : ""
        draft.rendered = appendVoiceText(draft.original.input, draft.committed, partial)
        current.set({ ...draft.original, input: draft.rendered })
        return { ok: true }
      })
      onCleanup(cleanup)
    } catch (error) {
      console.warn("voice input sink unavailable", error)
    }
  })

  return props.children
}

function startVoiceInputSink(handle: (event: VoiceInputEvent) => { ok: boolean; error?: string }) {
  const runtime = process.env.XDG_RUNTIME_DIR || "/tmp"
  const directory = path.join(runtime, `redcode-${process.getuid?.() ?? "user"}`, "voice-input")
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

function parseVoiceInputEvent(input: string, token: string): { ok: true; event: VoiceInputEvent } | { ok: false; error: string } {
  let value: Partial<VoiceInputEvent>
  try {
    value = JSON.parse(input) as Partial<VoiceInputEvent>
  } catch {
    return { ok: false, error: "invalid_json" }
  }
  if (value.version !== 1 || value.token !== token || typeof value.dictation_id !== "string") {
    return { ok: false, error: "invalid_request" }
  }
  if (value.event === "start" || value.event === "finish" || value.event === "cancel") {
    return { ok: true, event: value as VoiceInputEvent }
  }
  if ((value.event === "partial" || value.event === "commit") && typeof value.text === "string") {
    return { ok: true, event: value as VoiceInputEvent }
  }
  return { ok: false, error: "invalid_request" }
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
