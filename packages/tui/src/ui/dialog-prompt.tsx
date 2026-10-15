import { MouseButton, TextareaRenderable, TextAttributes, decodePasteBytes, stripAnsiSequences } from "@opentui/core"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog, type DialogSize } from "./dialog"
import { Show, createEffect, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { Spinner } from "../component/spinner"
import { useConfig } from "../config"
import { useRenderer } from "@opentui/solid"
import { useClipboard } from "../context/clipboard"
import { useToast } from "./toast"
import { createPasteDedupe } from "../component/prompt/paste-dedupe"

export type DialogPromptProps = {
  title: string
  size?: DialogSize
  description?: () => JSX.Element
  placeholder?: string
  value?: string
  busy?: boolean
  busyText?: string
  onConfirm?: (value: string) => void
  onCancel?: () => void
}

export function DialogPrompt(props: DialogPromptProps) {
  const dialog = useDialog()
  const renderer = useRenderer()
  const theme = useTheme().surface("dialog")
  const shortcuts = Keymap.useShortcuts()
  const config = useConfig().data
  const clipboard = useClipboard()
  const toast = useToast()
  const dedupe = createPasteDedupe()
  const [textareaTarget, setTextareaTarget] = createSignal<TextareaRenderable>()
  let textarea: TextareaRenderable
  let disposed = false
  let queue = Promise.resolve()
  onCleanup(() => {
    disposed = true
  })

  function paste() {
    const started = dedupe.keyStarted()
    queue = queue
      .then(async () => {
        if (disposed || props.busy || textarea.isDestroyed || !textarea.focused) return
        const before = textarea.plainText
        const content = await clipboard.read()
        if (disposed || props.busy || textarea.isDestroyed || !textarea.focused || textarea.plainText !== before) return
        if (content?.mime !== "text/plain" || !dedupe.acceptKeyText(started, content.data)) return
        textarea.insertText(
          stripAnsiSequences(content.data)
            .replace(/\r\n?/g, "\n")
            .replace(/^\n+|\n+$/g, ""),
        )
      })
      .catch((error) => {
        if (!disposed) toast.error(error)
      })
    return queue
  }

  function confirm() {
    if (props.busy) return
    props.onConfirm?.(textarea.plainText)
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    target: textareaTarget,
    enabled: textareaTarget() !== undefined && !props.busy,
    // Dialog form semantics must win over the global managed textarea input layer.
    priority: 1,
    commands: [
      {
        id: "prompt.paste",
        title: "Paste from clipboard",
        group: "Dialog",
        run: (_input, event) => {
          event?.preventDefault()
          event?.stopPropagation()
          return paste()
        },
      },
      {
        id: "dialog.prompt.submit",
        title: "Submit dialog prompt",
        group: "Dialog",
        run: confirm,
      },
    ],
  }))

  Keymap.createLayer(() => ({
    mode: "modal",
    enabled: props.onCancel !== undefined,
    priority: 1,
    commands: [
      {
        bind: "escape",
        title: "Back",
        group: "Dialog",
        run: () => {
          if (renderer.getSelection()) {
            renderer.clearSelection()
            return
          }
          if (!props.busy) props.onCancel?.()
        },
      },
    ],
  }))

  onMount(() => {
    dialog.setSize(props.size ?? "medium")
    setTimeout(() => {
      if (!textarea || textarea.isDestroyed) return
      if (props.busy) return
      textarea.focus()
    }, 1)
    textarea.gotoLineEnd()
  })

  createEffect(() => {
    if (!textarea || textarea.isDestroyed) return
    const traits = props.busy
      ? {
          suspend: true,
          status: "BUSY",
        }
      : {}
    textarea.traits = traits
    if (props.busy) {
      textarea.blur()
      return
    }
    textarea.focus()
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text.base}>
          {props.title}
        </text>
        <text
          fg={theme.text.muted}
          onMouseUp={() => {
            if (!props.busy) (props.onCancel ?? dialog.clear)()
          }}
        >
          esc
        </text>
      </box>
      <box gap={1}>
        {props.description?.()}
        <textarea
          height={1}
          wrapMode="none"
          ref={(val: TextareaRenderable) => {
            textarea = val
            setTextareaTarget(val)
          }}
          initialValue={props.value}
          placeholder={props.placeholder ?? "Enter text"}
          placeholderColor={theme.text.muted}
          textColor={props.busy ? theme.text.formfield.disabled : theme.text.formfield.base}
          focusedTextColor={props.busy ? theme.text.formfield.disabled : theme.text.formfield.base}
          cursorColor={props.busy ? theme.background.formfield.disabled : theme.text.base}
          cursorStyle={config.cursor}
          onPaste={(event) => {
            if (props.busy) {
              event.preventDefault()
              return
            }
            if (!event.bytes.length) {
              event.preventDefault()
              if (dedupe.acceptTerminalEmpty()) void paste()
              return
            }
            const text = decodePasteBytes(event.bytes)
            if (!dedupe.acceptTerminalText(text)) event.preventDefault()
          }}
          onMouseDown={(event) => {
            if (event.button !== MouseButton.RIGHT || props.busy) return
            event.preventDefault()
            event.stopPropagation()
            textarea.focus()
            void paste()
          }}
        />
        <Show when={props.busy}>
          <Spinner color={theme.text.muted}>{props.busyText ?? "Working…"}</Spinner>
        </Show>
      </box>
      <box paddingBottom={1} gap={1} flexDirection="row">
        <Show when={!props.busy} fallback={<text fg={theme.text.muted}>processing…</text>}>
          <Show when={shortcuts.get("prompt.paste")}>
            <text fg={theme.text.muted}>
              {shortcuts.get("prompt.paste")} paste
              {shortcuts.list("prompt.paste").includes("alt+v") ? " · alt+v if the terminal captures ctrl+v" : ""}
            </text>
          </Show>
          <Show when={shortcuts.get("dialog.prompt.submit")}>
            <text fg={theme.text.base}>
              {shortcuts.get("dialog.prompt.submit")} <span style={{ fg: theme.text.muted }}>submit</span>
            </text>
          </Show>
        </Show>
      </box>
    </box>
  )
}
