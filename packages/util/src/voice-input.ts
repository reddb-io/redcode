import { VoiceRecorder } from "./voice-recorder.js"

export type VoiceState = {
  phase: "idle" | "preparing" | "recording" | "transcribing" | "error"
  seconds: number
  level: number
  error?: "permission" | "unavailable" | "capture" | "transcription" | "changed" | "empty"
  transcript?: string
  retry: boolean
}

/** A recording owns one draft snapshot; late results can never follow focus to another draft. */
export function createVoiceInput(input: {
  recorder: () => Pick<VoiceRecorder, "start" | "stop" | "cancel">
  read: () => { owner: string; revision: string }
  prepare: () => Promise<void>
  transcribe: (audio: Blob, signal: AbortSignal) => Promise<string>
  insert: (text: string) => void
  change: (state: VoiceState) => void
}) {
  let operation: AbortController | undefined
  let recorder: ReturnType<typeof input.recorder> | undefined
  let captured: ReturnType<typeof input.read> | undefined
  let audio: Blob | undefined
  let state: VoiceState = { phase: "idle", seconds: 0, level: 0, retry: false }
  const change = (value: Partial<VoiceState>) => {
    state = { ...state, ...value }
    input.change(state)
  }
  const failed = (error: VoiceState["error"]) => change({ phase: "error", error, level: 0, retry: !!audio })
  const transcribe = async (current: AbortController) => {
    if (!audio) return
    change({ phase: "transcribing", error: undefined, level: 0, retry: false })
    try {
      const text = (await input.transcribe(audio, current.signal)).trim()
      if (current !== operation || current.signal.aborted) return
      if (!text) {
        failed("empty")
        return
      }
      const draft = input.read()
      if (!captured || draft.owner !== captured.owner || draft.revision !== captured.revision) {
        change({ transcript: text })
        failed("changed")
        return
      }
      input.insert(text)
      audio = undefined
      change({ phase: "idle", retry: false, transcript: undefined })
    } catch {
      if (current === operation && !current.signal.aborted) failed("transcription")
    }
  }
  const finish = async () => {
    if (state.phase !== "recording" || !recorder || !operation) return
    const current = operation
    change({ phase: "transcribing", level: 0 })
    try {
      const recording = await recorder.stop()
      if (current !== operation || current.signal.aborted) return
      audio = recording
      await transcribe(current)
    } catch {
      if (current === operation && !current.signal.aborted) failed("capture")
    }
  }
  return {
    get state() {
      return state
    },
    get busy() {
      return ["preparing", "recording", "transcribing"].includes(state.phase)
    },
    async start(device?: string) {
      if (["preparing", "recording", "transcribing"].includes(state.phase)) return
      operation?.abort()
      const current = new AbortController()
      operation = current
      captured = input.read()
      audio = undefined
      change({ phase: "preparing", seconds: 0, level: 0, error: undefined, transcript: undefined, retry: false })
      try {
        await input.prepare()
        if (current !== operation || current.signal.aborted) return
        const draft = input.read()
        if (draft.owner !== captured.owner || draft.revision !== captured.revision) {
          failed("changed")
          return
        }
        const capture = input.recorder()
        recorder = capture
        await capture.start({
          signal: current.signal,
          device,
          update: (value) => {
            if (current === operation && state.phase === "recording") change(value)
          },
          finish: () => {
            void finish()
          },
        })
        if (current !== operation || current.signal.aborted) {
          capture.cancel()
          return
        }
        change({ phase: "recording" })
      } catch (error) {
        if (current !== operation || current.signal.aborted) return
        recorder?.cancel()
        failed(
          error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name)
            ? "permission"
            : error instanceof Error && error.message === "unavailable"
              ? "unavailable"
              : "capture",
        )
      }
    },
    finish,
    async retry() {
      if (state.phase !== "error" || !audio || !operation) return
      await transcribe(operation)
    },
    cancel() {
      operation?.abort()
      recorder?.cancel()
      operation = undefined
      recorder = undefined
      audio = undefined
      change({ phase: "idle", seconds: 0, level: 0, error: undefined, transcript: undefined, retry: false })
    },
  }
}
