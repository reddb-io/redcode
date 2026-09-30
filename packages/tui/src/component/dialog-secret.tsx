import { decodePasteBytes, stripAnsiSequences, TextAttributes } from "@opentui/core"
import { usePaste, useRenderer } from "@opentui/solid"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { useClipboard } from "../context/clipboard"
import { useInteractivity } from "../context/interactivity"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { secretKey, secretLength, secretMask, secretPaste } from "../util/secret"

/** A dialog that takes one secret masked, for adding a secret by hand; `onConfirm` receives the value once. */
export function DialogSecret(props: {
  title: string
  description?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}) {
  const dialog = useDialog()
  const renderer = useRenderer()
  const theme = useTheme().surface("dialog")
  const keymap = Keymap.use()
  const enabled = useInteractivity()
  const secret = createSecretInput(() => enabled() && keymap.mode.current() === "modal")

  function confirm() {
    if (secret.length() === 0) return
    props.onConfirm(secret.value())
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        id: "prompt.paste",
        title: "Paste the secret from the clipboard",
        group: "Dialog",
        run: (_input, event) => {
          event?.preventDefault()
          event?.stopPropagation()
          return secret.paste()
        },
      },
    ],
  }))

  Keymap.createLayer(() => ({
    mode: "modal",
    // Masked input semantics must win over the dialog's own escape.
    priority: 1,
    commands: [
      { bind: "return", title: "Store the secret", group: "Dialog", run: confirm },
      {
        bind: "escape",
        title: "Back",
        group: "Dialog",
        run: () => {
          if (renderer.getSelection()) {
            renderer.clearSelection()
            return
          }
          props.onCancel()
        },
      },
    ],
  }))

  onMount(() => dialog.setSize("medium"))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text.base}>
          {props.title}
        </text>
        <text fg={theme.text.muted} onMouseUp={props.onCancel}>
          esc
        </text>
      </box>
      <box gap={1}>
        <Show when={props.description}>
          <text fg={theme.text.muted}>{props.description}</text>
        </Show>
        <SecretField length={secret.length()} active={true} />
      </box>
      <box paddingBottom={1} flexDirection="row" gap={2}>
        <text fg={theme.text.base} onMouseUp={confirm}>
          enter <span style={{ fg: theme.text.muted }}>store</span>
        </text>
        <text fg={theme.text.base} onMouseUp={props.onCancel}>
          esc <span style={{ fg: theme.text.muted }}>cancel</span>
        </text>
        <text fg={theme.text.muted}>the value is never shown</text>
      </box>
    </box>
  )
}

/** The masked field: bullets and a count, never a character of the value. */
export function SecretField(props: { length: number; active: boolean }) {
  const theme = useTheme()
  return (
    <box flexDirection="row" gap={1}>
      <Show when={props.length > 0} fallback={<text fg={theme.text.muted}>Type or paste the value</text>}>
        <text fg={props.active ? theme.text.formfield.focused : theme.text.formfield.base}>
          {secretMask(props.length)}
        </text>
        <text fg={theme.text.muted}>{props.length === 1 ? "1 character" : `${props.length} characters`}</text>
      </Show>
    </box>
  )
}

/**
 * Masked text input while `active` holds. The value lives only in this closure: nothing renders, persists or logs
 * it, and only its length is reactive.
 */
export function createSecretInput(active: () => boolean) {
  const keymap = Keymap.use()
  const clipboard = useClipboard()
  const toast = useToast()
  let value = ""
  const [length, setLength] = createSignal(0)
  const update = (next: string) => {
    value = next
    setLength(secretLength(next))
  }

  onCleanup(() => {
    value = ""
  })

  // Runs ahead of the bindings, so plain letters bound elsewhere are typed into the secret instead.
  onCleanup(
    keymap.intercept("key", ({ event, consume }) => {
      if (!active()) return
      const next = secretKey(value, event)
      if (next === undefined) return
      update(next)
      consume()
    }),
  )

  usePaste((event) => {
    if (!active()) return
    update(secretPaste(value, stripAnsiSequences(decodePasteBytes(event.bytes))))
    event.preventDefault()
  })

  return {
    length,
    value: () => value,
    clear: () => update(""),
    paste: () =>
      clipboard
        .read()
        .then((content) => {
          if (!active() || content?.mime !== "text/plain") return
          update(secretPaste(value, stripAnsiSequences(content.data)))
        })
        .catch(toast.error),
  }
}
