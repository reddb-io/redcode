import { Vault } from "@opencode/schema/vault"
import { Option, Schema } from "effect"
import { createResource, Show } from "solid-js"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useTheme } from "../context/theme"
import { DialogConfirm } from "../ui/dialog-confirm"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { Locale } from "../util/locale"

const decodeEntries = Schema.decodeUnknownOption(Schema.Array(Vault.Entry))
const decodeMoved = Schema.decodeUnknownOption(Vault.Moved)
const decodeRestricted = Schema.decodeUnknownOption(Vault.Restricted)

/** The secrets a user message had moved into the vault, from its `metadata.vault` marker. */
export function vaultMoved(metadata: Record<string, unknown> | undefined) {
  return Option.getOrElse(decodeMoved(metadata?.vault), () => [])
}

/** The restricted messages of a Session, from its `metadata.restricted` marker. */
export function restrictedMessages(metadata: Record<string, unknown> | undefined) {
  return Option.getOrElse(decodeRestricted(metadata?.restricted), (): Vault.Restricted => ({}))
}

/** What the transcript and the toast say after secrets were moved; it claims no more than the vault does. */
export function vaultNotice(moved: Vault.Moved) {
  const references = moved.map((item) => Vault.reference(item.name)).join(", ")
  return [
    moved.length === 1
      ? `1 secret was replaced by ${references} before this message was stored, so it is no longer part of the context sent to the model from now on.`
      : `${moved.length} secrets were replaced by ${references} before this message was stored, so they are no longer part of the context sent to the model from now on.`,
    "The vault keeps values in memory until the service restarts.",
    "Anything you sent before this message stays in your local history and with your provider: rotate anything real.",
  ].join(" ")
}

const SENT = "The original text stays in your local history and has already been sent to your provider: rotate anything real."

/**
 * What the transcript and the toast say about a restricted message. A sensitive one is only kept out of derived text,
 * so the notice says it is still in the conversation; neither state claims the provider never saw it.
 */
export function restrictedNotice(state: "sensitive" | "withheld") {
  if (state === "withheld")
    return `Removed from context: every later request to the model carries "${Vault.WITHHELD}" in its place. ${SENT}`
  return `Possible restricted content in this message; it is excluded from summaries and titles from now on. It is still in the current conversation until you remove it: select the message and choose Remove from context. ${SENT}`
}

/** Withholds a user message after the user confirms; the confirmation says what the placeholder costs. */
export function useWithhold() {
  const client = useClient()
  const data = useData()
  const dialog = useDialog()
  const toast = useToast()
  return (sessionID: string, messageID: string) =>
    dialog.replace(() => (
      <DialogConfirm
        title="Remove from context"
        message={`Every later request to the model carries "${Vault.WITHHELD}" instead of this message, including any instruction in it. It cannot be put back from here. The original stays in your local history.`}
        label={{ confirm: "remove" }}
        onConfirm={() => {
          const directory = data.session.get(sessionID)?.location.directory
          void client.api.rpc
            .call({
              rpcID: Vault.Definition.id,
              method: "withhold",
              input: { sessionID, messageID },
              location: directory === undefined ? undefined : { directory },
            })
            .then((result) => {
              if (result.output === true)
                toast.show({ variant: "success", message: restrictedNotice("withheld"), duration: 12_000 })
            })
            .catch(toast.error)
        }}
      />
    ))
}

/**
 * The messages of this Session marked restricted, with Remove from context. It is also where the user learns that a
 * message nothing flagged may simply not have been checked.
 */
export function DialogRestricted(props: { sessionID: string }) {
  const data = useData()
  const theme = useTheme().surface("dialog")
  const withhold = useWithhold()
  const marked = () => Object.entries(restrictedMessages(data.session.get(props.sessionID)?.metadata))
  return (
    <DialogSelect
      title="Restricted messages"
      options={marked().map(([messageID, state]) => {
        const message = data.session.message.get(props.sessionID, messageID)
        return {
          value: messageID,
          title: state === "withheld" ? "Removed from context" : "Possible restricted content",
          description: state === "withheld" ? "enter does nothing" : "enter to remove from context",
          footer: message ? Locale.datetime(message.time.created) : undefined,
        }
      })}
      onSelect={(option) => {
        if (restrictedMessages(data.session.get(props.sessionID)?.metadata)[option.value] === "sensitive")
          withhold(props.sessionID, option.value)
      }}
      emptyView={<text fg={theme.text.muted}>No message in this session is marked restricted.</text>}
      footer={
        <text fg={theme.text.muted}>
          System One reads each message for restricted content only with dual reasoning; a message it could not read
          is not checked, not clean.
        </text>
      }
    />
  )
}

/** Names and kinds of this project's vault, with forget; there is no way to show a value. */
export function DialogVault(props: { sessionID: string; directory?: string }) {
  const client = useClient()
  const dialog = useDialog()
  const toast = useToast()
  const theme = useTheme().surface("dialog")
  const call = (method: "list" | "forget", input: Record<string, string>) =>
    client.api.rpc
      .call({
        rpcID: Vault.Definition.id,
        method,
        input,
        location: props.directory === undefined ? undefined : { directory: props.directory },
      })
      .then((result) => result.output)
  const [entries] = createResource(() =>
    call("list", { sessionID: props.sessionID })
      .then((output) => Option.getOrElse(decodeEntries(output), () => []))
      .catch((error: unknown) => {
        toast.error(error)
        return []
      }),
  )
  const forget = (name: string) =>
    dialog.replace(() => (
      <DialogConfirm
        title="Forget secret"
        message={`Forget ${Vault.reference(name)}? The model can no longer use it, and a reference to it fails until the secret is pasted again.`}
        label={{ confirm: "forget" }}
        onConfirm={() => {
          void call("forget", { sessionID: props.sessionID, name })
            .then(() => toast.show({ variant: "success", message: `Forgot ${Vault.reference(name)}` }))
            .catch(toast.error)
        }}
      />
    ))

  return (
    <DialogSelect
      title="Project vault"
      options={(entries() ?? []).map((entry) => ({
        value: entry.name,
        title: Vault.reference(entry.name),
        description: entry.kind,
        footer: Locale.datetime(entry.created),
      }))}
      onSelect={(option) => forget(option.value)}
      emptyView={
        <Show when={!entries.loading} fallback={<text fg={theme.text.muted}>Loading …</text>}>
          <text fg={theme.text.muted}>No secrets in this project's vault.</text>
        </Show>
      }
      footer={<text fg={theme.text.muted}>enter to forget · values are never shown</text>}
    />
  )
}
