import type { LocationRef } from "@opencode/client"
import { createResource, createSignal, For, Show } from "solid-js"
import { useClient } from "../context/client"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"

const actions = {
  trust: ["Trust project hooks", "Run these project hook commands until their definitions change?"],
  revoke: ["Revoke project hooks", "Stop running project hooks for this project?"],
  import: ["Import Claude hooks", "Copy hooks from .claude/settings*.json into the existing project config?"],
} as const

export function DialogHooks(props: { location: LocationRef }) {
  const client = useClient()
  const theme = useTheme().surface("dialog")
  const dialog = useDialog()
  const toast = useToast()
  const [action, setAction] = createSignal<keyof typeof actions>()
  const [busy, setBusy] = createSignal(false)
  const [status, { refetch }] = createResource(
    () => props.location,
    (location) =>
      client.api.hook.status({ location }).then(
        (result) => ({ data: result.data, error: undefined }),
        (error: unknown) => ({ data: undefined, error: errorMessage(error) }),
      ),
  )
  function confirm(value: keyof typeof actions) {
    if (!busy() && !status.loading && status()?.data) setAction(value)
  }
  async function apply() {
    const value = action()
    if (!value || busy()) return
    setBusy(true)
    await client.api.hook[value]({ location: props.location })
      .then(
        async (result) => {
          toast.show({
            variant: "success",
            message:
              "imported" in result.data
                ? `Imported ${result.data.imported} hooks. Reopen this project to reload them.`
                : value === "trust"
                  ? "Project hooks trusted"
                  : "Hook trust revoked",
          })
          setAction(undefined)
          await refetch()
        },
        (error: unknown) => toast.error(error),
      )
      .finally(() => setBusy(false))
  }
  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "escape", title: "Back or close hooks", run: () => (action() ? setAction(undefined) : dialog.clear()) },
      ...(action()
        ? [{ bind: "return", title: "Confirm hook action", run: () => void apply() }]
        : [
            { bind: "t", title: "Trust hooks", run: () => confirm("trust") },
            { bind: "r", title: "Revoke hooks", run: () => confirm("revoke") },
            { bind: "i", title: "Import Claude hooks", run: () => confirm("import") },
          ]),
    ],
  }))
  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <text fg={theme.text.base}>
        <b>Project hooks</b>
      </text>
      <Show when={action()} fallback={<text fg={theme.text.muted}>t trust · r revoke · i import · esc close</text>}>
        {(value) => (
          <box gap={1}>
            <text fg={theme.text.base}>
              <b>{actions[value()][0]}</b>
            </text>
            <text fg={theme.text.muted} wrapMode="word">
              {actions[value()][1]}
            </text>
            <text fg={theme.text.action.primary.base} onMouseUp={() => void apply()}>
              {busy() ? "Applying…" : "Enter to confirm · Esc to cancel"}
            </text>
          </box>
        )}
      </Show>
      <Show when={status()?.error}>
        <text fg={theme.text.feedback.error.base} wrapMode="word">
          Hooks unavailable: {status()?.error}
        </text>
      </Show>
      <Show
        when={status()?.data}
        fallback={<text fg={theme.text.muted}>{status.loading ? "Loading hooks…" : ""}</text>}
      >
        {(current) => (
          <>
            <text fg={current().trust.trusted ? theme.text.feedback.success.base : theme.text.feedback.warning.base}>
              {current().trust.trusted ? "Trusted" : "Approval required"} · {current().trust.fingerprint.slice(0, 12)}
            </text>
            <scrollbox maxHeight={12}>
              <Show
                when={current().definitions.length}
                fallback={<text fg={theme.text.muted}>No hooks configured</text>}
              >
                <For each={current().definitions}>
                  {(definition) => (
                    <box>
                      <text fg={theme.text.base} wrapMode="word">
                        <b>{definition.event}</b>
                        {definition.matcher ? ` [${definition.matcher}]` : ""} · {definition.handler.type}
                      </text>
                      <text
                        fg={
                          definition.support === "active"
                            ? theme.text.feedback.success.base
                            : definition.support === "untrusted"
                              ? theme.text.feedback.warning.base
                              : theme.text.muted
                        }
                        wrapMode="word"
                      >
                        {definition.support} · {definition.reason ?? definition.source}
                      </text>
                    </box>
                  )}
                </For>
              </Show>
            </scrollbox>
          </>
        )}
      </Show>
    </box>
  )
}
