import { createEffect, createMemo, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation } from "@solidjs/router"
import { createVoiceInput, type VoiceState } from "@opencode/util/voice-input"
import { VoiceRecorder, voiceAudioBase64 } from "@opencode/util/voice-recorder"
import { Button } from "@opencode/ui/button"
import { IconButton } from "@opencode/ui/icon-button"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import { useServer } from "@/runtime/server/current"
import { usePlatform } from "@/runtime/platform/platform"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useSettings } from "@/settings/model"
import type { ComposerAdapter } from "./adapter"
import { createComposerEditorActions } from "./editor/actions"

export function createComposerVoice(adapter: ComposerAdapter) {
  const server = useServer()
  const route = useLocation()
  const sdk = useWorkspaceLocation()
  const platform = usePlatform()
  const settings = useSettings()
  const [state, setState] = createStore<VoiceState>({ phase: "idle", seconds: 0, level: 0, retry: false })
  const draft = createComposerEditorActions(adapter.state.store)
  const cursor = { value: 0 }
  const voice = createVoiceInput({
    recorder: () => new VoiceRecorder(),
    read: () => ({
      owner: `${server.key}:${sdk().directory}:${adapter.kind === "active-session" ? adapter.session().id : "new"}`,
      revision: JSON.stringify([adapter.state.current(), adapter.state.mode.current(), adapter.state.context.items()]),
    }),
    prepare: async () => {
      const entries = await server.ctx.sdk.api.config.get({ location: { directory: sdk().directory } })
      if (!entries.some((entry) => entry.type === "document" && entry.info.voice)) {
        throw new Error("unavailable")
      }
      cursor.value =
        adapter.state.cursor() ??
        draft.state.prompt.reduce((length, part) => length + ("content" in part ? part.content.length : 0), 0)
      if (platform.requestMicrophone && !(await platform.requestMicrophone()))
        throw new DOMException("Microphone permission denied", "NotAllowedError")
    },
    transcribe: async (audio, signal) =>
      (
        await server.ctx.sdk.api.voice.transcribe(
          { audio: await voiceAudioBase64(audio), location: { directory: sdk().directory } },
          { signal },
        )
      ).text,
    insert: (text) => {
      const before = draft.state.prompt
        .map((part) => ("content" in part ? part.content : ""))
        .join("")
        .slice(0, cursor.value)
      draft.setCursor(cursor.value)
      draft.addText(`${before && !/\s$/.test(before) ? " " : ""}${text} `)
    },
    change: setState,
  })
  onCleanup(voice.cancel)
  // A composer can survive navigation; its own identity still ends the recording.
  const owner = createMemo(
    () =>
      `${route.pathname}${route.search}:${sdk().directory}:${adapter.kind === "active-session" ? adapter.session().id : "new"}`,
  )
  const capturedOwner = { value: owner() }
  createEffect(() => {
    if (owner() !== capturedOwner.value) {
      voice.cancel()
      capturedOwner.value = owner()
    }
  })
  return {
    state,
    busy: () => ["preparing", "recording", "transcribing"].includes(state.phase),
    start: () => voice.start(settings.voice.device() || undefined),
    finish: voice.finish,
    cancel: voice.cancel,
    retry: voice.retry,
    copy: () =>
      state.transcript &&
      (platform.writeClipboardText?.(state.transcript) ?? navigator.clipboard.writeText(state.transcript)),
  }
}

export function ComposerVoiceControl(props: { voice: ReturnType<typeof createComposerVoice>; disabled?: boolean }) {
  const language = useLanguage()
  const state = props.voice.state
  const label = () => language.t(state.phase === "recording" ? "voice.stop" : "voice.start")
  return (
    <div class="flex items-center gap-1" aria-busy={props.voice.busy()}>
      <Show when={props.voice.busy() || state.phase === "error"}>
        <span class="max-w-24 truncate text-caption text-ink-muted sm:max-w-56" role="status">
          {state.phase === "recording"
            ? `${Math.floor(state.seconds / 60)}:${String(state.seconds % 60).padStart(2, "0")}`
            : state.error
              ? language.t(`voice.error.${state.error}`)
              : language.t(`voice.${state.phase === "preparing" ? "preparing" : "transcribing"}`)}
        </span>
        <Show when={state.phase === "recording"}>
          <meter min="0" max="1" value={state.level} aria-label={language.t("voice.level")} class="h-1 w-10" />
        </Show>
        <Show when={state.retry && state.error !== "changed"}>
          <Button type="button" size="small" variant="ghost" onClick={() => void props.voice.retry()}>
            {language.t("voice.retry")}
          </Button>
        </Show>
        <Show when={state.transcript}>
          <Button type="button" size="small" variant="ghost" onClick={() => void props.voice.copy()}>
            {language.t("voice.copy")}
          </Button>
        </Show>
        <IconButton
          type="button"
          icon={<Icon name="close" size="small" />}
          size="small"
          aria-label={language.t("voice.cancel")}
          onClick={props.voice.cancel}
        />
      </Show>
      <IconButton
        type="button"
        size="small"
        icon={<Icon name={state.phase === "recording" ? "stop" : "microphone"} size="small" />}
        aria-label={label()}
        title={label()}
        aria-pressed={state.phase === "recording"}
        disabled={props.disabled || state.phase === "preparing" || state.phase === "transcribing"}
        onClick={() => void (state.phase === "recording" ? props.voice.finish() : props.voice.start())}
      />
    </div>
  )
}
