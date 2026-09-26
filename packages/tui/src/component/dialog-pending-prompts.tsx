import type { SessionPendingPrompt } from "@reddb-io/redcode-sdk/v2"
import { createResource, createSignal } from "solid-js"
import { useSDK } from "../context/sdk"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import { pendingLabel, pendingPreview } from "../prompt/pending"

// The prompts a session has admitted and not yet promoted. A queued prompt waits for the running
// turn to end; a held one missed the idle boundary it waited for (an Esc, a failed turn, a restart)
// and only reaches the model once it is sent from here. Each can be sent now or discarded.
export function DialogPendingPrompts(props: { sessionID: string }) {
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const [busy, setBusy] = createSignal(false)
  const [items] = createResource(async () => {
    const result = await sdk.client.session.pendingPrompts({ sessionID: props.sessionID }).catch(() => undefined)
    return result?.data
  })
  const reopen = () => dialog.replace(() => <DialogPendingPrompts {...props} />)

  async function act(run: () => Promise<boolean>, done: string, failed: string) {
    setBusy(true)
    const ok = await run().catch(() => false)
    setBusy(false)
    toast.show({ variant: ok ? "success" : "error", message: ok ? done : failed })
    reopen()
  }

  const discard = (item: SessionPendingPrompt) =>
    sdk.client.session
      .promptDiscard({ sessionID: props.sessionID, messageID: item.id })
      .then((result) => result.error === undefined)

  function details(item: SessionPendingPrompt) {
    dialog.replace(() => (
      <DialogSelect
        title={pendingPreview(item.text)}
        locked={busy()}
        options={[
          ...(item.delivery === "queue"
            ? [
                {
                  title: "Send now",
                  value: "send",
                  description: "Delivered as a steer: at the next step of a running turn, or right away when idle.",
                },
              ]
            : []),
          { title: "Discard", value: "discard", description: "Never reaches the model." },
          { title: "Back to pending prompts", value: "back" },
        ]}
        onSelect={(option) => {
          if (option.value === "back") return reopen()
          if (option.value === "send")
            return act(
              () =>
                sdk.client.session
                  .promptDelivery({ sessionID: props.sessionID, messageID: item.id, delivery: "steer" })
                  .then((result) => result.error === undefined),
              "Prompt sent.",
              "The prompt is no longer pending.",
            )
          return act(() => discard(item), "Prompt discarded.", "The prompt is no longer pending.")
        }}
      />
    ))
  }

  return (
    <DialogSelect
      title={items.loading ? "Loading pending prompts…" : "Pending prompts"}
      placeholder="Search prompts"
      locked={busy()}
      emptyView={
        <text>
          {items.loading
            ? "Loading…"
            : items() === undefined
              ? "Could not load pending prompts. Reopen /pending to retry."
              : "Nothing is waiting in this session."}
        </text>
      }
      options={[
        ...(items() ?? []).map((item) => ({
          title: pendingPreview(item.text),
          value: item.id,
          description: pendingLabel(item),
          footer: new Date(item.time).toLocaleString(),
          onSelect: () => details(item),
        })),
        ...((items() ?? []).length > 1
          ? [
              {
                title: `Discard all ${(items() ?? []).length}`,
                value: "discard-all",
                description: "None of them reaches the model.",
                onSelect: () => {
                  const all = items() ?? []
                  void act(
                    () => Promise.all(all.map(discard)).then((results) => results.every(Boolean)),
                    `Discarded ${all.length} prompts.`,
                    "Some prompts were no longer pending.",
                  )
                },
              },
            ]
          : []),
      ]}
    />
  )
}
