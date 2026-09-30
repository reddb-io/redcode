import { TextAttributes } from "@opentui/core"
import { Vault } from "@opencode/schema/vault"
import { Schema } from "effect"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { createSecretInput, SecretField } from "../../component/dialog-secret"
import { useClient } from "../../context/client"
import { useData, type FormWithLocation } from "../../context/data"
import { useInteractivity } from "../../context/interactivity"
import { Keymap } from "../../context/keymap"
import { useTheme } from "../../context/theme"
import { SplitBorder } from "../../ui/border"
import { useToast } from "../../ui/toast"
import { DialogEscape } from "../../util/dialog-escape"
import { FORM_MODE } from "./form"

/** The request of a pending form opened by `vault_request`, or none for any other form. */
export const decodeVaultForm = Schema.decodeUnknownOption(Vault.FormRequest)

/**
 * The form `vault_request` opens, answered without ever drawing the value: typed and pasted characters show as
 * bullets, and the reply carries the value straight from the input to the server.
 */
export function SecretPrompt(props: {
  form: FormWithLocation
  request: Vault.FormRequest
  /** Closes the prompt locally, without an answer from the server. */
  onEscape?: () => void
}) {
  const data = useData()
  const client = useClient()
  const theme = useTheme()
  const toast = useToast()
  const keymap = Keymap.use()
  const enabled = useInteractivity()
  const active = () => enabled() && keymap.mode.current() === FORM_MODE
  const secret = createSecretInput(active)
  const [error, setError] = createSignal("")
  const dismissedTwice = DialogEscape.createPresses()
  const watchReply = DialogEscape.createReplyWatch({
    delay: () => DialogEscape.replyDelay(client.endpoint?.url),
    slow: () => {
      toast.show({ variant: "warning", message: DialogEscape.SLOW_NOTICE })
      data.session.form.invalidate(props.form.sessionID, props.form.location)
      void data.session.form.sync(props.form.sessionID, props.form.location).catch(() => undefined)
    },
  })
  // A server error could quote the request it rejected, so the prompt never shows one.
  const failed = () => setError("The server did not take the answer; try again or press esc to decline.")

  function submit() {
    if (secret.length() === 0) {
      setError("Type or paste the value first, or press esc to decline.")
      return
    }
    setError("")
    void watchReply(
      data.session.form.reply(
        { sessionID: props.form.sessionID, formID: props.form.id, answer: { [Vault.FORM_FIELD]: secret.value() } },
        props.form.location,
      ),
    ).catch(failed)
  }

  function cancel() {
    // A second dismissal soon after the first closes the prompt even when the server never answers.
    if (dismissedTwice() && props.onEscape) {
      toast.show({ variant: "warning", message: DialogEscape.ESCAPED_NOTICE })
      props.onEscape()
      return
    }
    void watchReply(
      data.session.form.cancel({ sessionID: props.form.sessionID, formID: props.form.id }, props.form.location),
    ).catch(failed)
  }

  onMount(() => onCleanup(keymap.mode.push(FORM_MODE)))

  Keymap.createLayer(() => ({
    mode: FORM_MODE,
    commands: [
      {
        id: "prompt.paste",
        title: "Paste the secret from the clipboard",
        group: "Form",
        run: (_input, event) => {
          event?.preventDefault()
          event?.stopPropagation()
          return secret.paste()
        },
      },
    ],
  }))

  Keymap.createLayer(() => ({
    mode: FORM_MODE,
    priority: 1,
    commands: [
      {
        id: "prompt.clear",
        title: "Clear the secret",
        group: "Form",
        run() {
          if (secret.length() === 0) {
            cancel()
            return
          }
          secret.clear()
        },
      },
      { bind: "return", title: "Store the secret", group: "Form", run: submit },
      { bind: "escape", title: "Decline the secret request", group: "Form", run: cancel },
    ],
  }))

  return (
    <box
      backgroundColor={theme.background.raised.base}
      border={["left"]}
      borderColor={theme.background.action.primary.focused}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={2} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <text fg={theme.text.muted}>{props.form.title}</text>
        <box>
          <text fg={theme.text.base}>
            The agent asks for{" "}
            <span style={{ attributes: TextAttributes.BOLD }}>{Vault.reference(props.request.name)}</span>
          </text>
          <Show when={props.request.purpose}>
            <text fg={theme.text.muted}>{props.request.purpose}</text>
          </Show>
        </box>
        <SecretField length={secret.length()} active={active()} />
        <text fg={theme.text.muted}>
          It is stored in this project's vault; the model works with the reference and never reads the value.
        </text>
      </box>
      <box
        flexDirection="row"
        flexShrink={0}
        gap={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        justifyContent="space-between"
      >
        <box flexDirection="row" gap={2}>
          <text fg={theme.text.base} onMouseUp={submit}>
            enter <span style={{ fg: theme.text.muted }}>store</span>
          </text>
          <text fg={theme.text.base} onMouseUp={cancel}>
            esc <span style={{ fg: theme.text.muted }}>decline</span>
          </text>
          <text fg={theme.text.muted}>the value is never shown</text>
        </box>
        <Show when={error()}>
          <text fg={theme.text.feedback.error.base}>{error()}</text>
        </Show>
      </box>
    </box>
  )
}
