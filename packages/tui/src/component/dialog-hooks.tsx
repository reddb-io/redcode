import { TextAttributes } from "@opentui/core"
import { createSignal, For, onMount, Show } from "solid-js"
import type { V2HookStatusResponse } from "@reddb-io/redcode-sdk/v2"
import { useSDK } from "../context/sdk"
import { useLocation } from "../context/location"
import { useTheme } from "../context/theme"
import { useBindings } from "../keymap"
import { DialogConfirm } from "../ui/dialog-confirm"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"

type Status = V2HookStatusResponse["data"]

export function DialogHooks() {
  const sdk = useSDK()
  const location = useLocation()
  const { theme } = useTheme()
  const dialog = useDialog()
  const toast = useToast()
  const [status, setStatus] = createSignal<Status>()
  const [loading, setLoading] = createSignal(true)

  const query = () => {
    const ref = location()
    return ref ? { directory: ref.directory, workspace: ref.workspaceID } : undefined
  }

  const load = async () => {
    setLoading(true)
    await sdk.client.v2.hook
      .status({ location: query() }, { throwOnError: true })
      .then((result) => setStatus(result.data.data))
      .catch(toast.error)
      .finally(() => setLoading(false))
  }

  const confirm = async (action: "trust" | "revoke" | "import") => {
    const descriptions = {
      trust: ["Trust project hooks", "Run the configured project hook commands until their definitions change?"],
      revoke: ["Revoke project hooks", "Stop running all project hooks for this project?"],
      import: ["Import Claude hooks", "Copy hooks from .claude/settings*.json into the active Redcode config?"],
    } as const
    const accepted = await DialogConfirm.show(dialog, descriptions[action][0], descriptions[action][1])
    if (!accepted) return dialog.replace(() => <DialogHooks />)
    const request = sdk.client.v2.hook[action]({ location: query() }, { throwOnError: true })
    await request
      .then((result) => {
        if (action === "import" && "imported" in result.data.data)
          toast.show({
            variant: "success",
            message: `Imported ${result.data.data.imported} hooks. Reopen this project to reload them.`,
          })
        if (action !== "import")
          toast.show({
            variant: "success",
            message: action === "trust" ? "Project hooks trusted" : "Hook trust revoked",
          })
      })
      .catch(toast.error)
    dialog.replace(() => <DialogHooks />)
  }

  onMount(() => void load())

  useBindings(() => ({
    bindings: [
      { key: "t", desc: "Trust hooks", group: "Hooks", cmd: () => void confirm("trust") },
      { key: "r", desc: "Revoke trust", group: "Hooks", cmd: () => void confirm("revoke") },
      { key: "i", desc: "Import Claude hooks", group: "Hooks", cmd: () => void confirm("import") },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Hooks
        </text>
        <text fg={theme.textMuted}>t trust · r revoke · i import · esc</text>
      </box>
      <Show when={!loading()} fallback={<text fg={theme.textMuted}>Loading hooks…</text>}>
        <Show when={status()}>
          {(current) => (
            <>
              <text fg={current().trust.trusted ? theme.success : theme.warning}>
                {current().trust.trusted ? "● trusted" : "● approval required"}{" "}
                {current().trust.fingerprint.slice(0, 12)}
              </text>
              <Show
                when={current().definitions.length > 0}
                fallback={<text fg={theme.textMuted}>No hooks configured</text>}
              >
                <For each={current().definitions}>
                  {(definition) => (
                    <box flexDirection="row" gap={1}>
                      <text
                        flexShrink={0}
                        fg={
                          definition.support === "active"
                            ? theme.success
                            : definition.support === "untrusted"
                              ? theme.warning
                              : theme.textMuted
                        }
                      >
                        {definition.support === "active" ? "●" : definition.support === "untrusted" ? "◆" : "○"}
                      </text>
                      <text fg={theme.text} wrapMode="word">
                        <b>{definition.event}</b>
                        {definition.matcher ? ` [${definition.matcher}]` : ""} · {definition.handler.type}
                        <span style={{ fg: theme.textMuted }}>
                          {definition.reason ? ` — ${definition.reason}` : ` — ${definition.source}`}
                        </span>
                      </text>
                    </box>
                  )}
                </For>
              </Show>
            </>
          )}
        </Show>
      </Show>
    </box>
  )
}
