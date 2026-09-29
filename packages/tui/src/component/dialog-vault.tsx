import { Vault } from "@opencode/schema/vault"
import { Option, Schema } from "effect"
import { createResource, Show } from "solid-js"
import { useClient } from "../context/client"
import { useTheme } from "../context/theme"
import { DialogConfirm } from "../ui/dialog-confirm"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { Locale } from "../util/locale"

const decodeEntries = Schema.decodeUnknownOption(Schema.Array(Vault.Entry))
const decodeMoved = Schema.decodeUnknownOption(Vault.Moved)

/** The secrets a user message had moved into the vault, from its `metadata.vault` marker. */
export function vaultMoved(metadata: Record<string, unknown> | undefined) {
  return Option.getOrElse(decodeMoved(metadata?.vault), () => [])
}

/** What the transcript and the toast say after secrets were moved; it claims no more than the vault does. */
export function vaultNotice(moved: Vault.Moved) {
  const count = moved.length === 1 ? "1 secret" : `${moved.length} secrets`
  return [
    `${count} moved to this project's vault as ${moved.map((item) => Vault.reference(item.name)).join(", ")}.`,
    "The model sees only the reference. The vault keeps values in memory until the service restarts.",
    "Your message was changed before it was stored, but anything you sent earlier stays in your history and with your provider: rotate it.",
  ].join(" ")
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
