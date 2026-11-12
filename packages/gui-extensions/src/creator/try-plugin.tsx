import { onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { TextField } from "@opencode/ui/text-field"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { useExtension, type SessionRef } from "../sdk"
import type definition from "./index"

export default function TryPlugin(props: {
  session: SessionRef
  name: string
  tools: readonly string[]
  close: () => void
}) {
  const ctx = useExtension<typeof definition>()
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  const [state, setState] = createStore({ request: "", pending: false, error: "" })
  const busy = () => props.session.server.data.session.status(props.session.id) !== "idle"
  const submit = async () => {
    if (state.pending || busy() || !state.request.trim()) return
    if (!props.session.server.data.session.get(props.session.id)?.model) {
      setState("error", ctx.t("create.model.required"))
      return
    }
    setState({ pending: true, error: "" })
    try {
      await props.session.server.client.session.switchAgent(
        { sessionID: props.session.id, agent: "build" },
        { signal: controller.signal },
      )
      if (controller.signal.aborted) return
      await props.session.server.data.session.prompt({
        sessionID: props.session.id,
        text: [
          `Test the installed plugin ${props.name} using its registered tools: ${props.tools.join(", ")}.`,
          "Make actual tool calls for the user's test case rather than reimplementing the tools. Respect tool permissions, report actual results and failures, and do not claim success without a call. If a tool is unavailable, explain the runtime problem. Do not change the plugin or install anything as part of this test.",
          `User test case:\n${state.request.trim()}`,
        ].join("\n\n"),
      })
      if (!controller.signal.aborted) props.close()
    } catch (error) {
      if (!controller.signal.aborted)
        setState("error", error instanceof Error ? error.message : ctx.t("request.failed"))
    } finally {
      if (!controller.signal.aborted) setState("pending", false)
    }
  }
  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup
          title={ctx.t("plugins.try.title", { name: props.name })}
          description={ctx.t("plugins.try.description")}
        />
      </DialogHeader>
      <div class="space-y-3 px-6 pb-4">
        <p class="break-words font-mono text-12-regular text-ink-muted">
          {ctx.t("plugins.tools", { tools: props.tools.join(", ") })}
        </p>
        <TextField
          label={ctx.t("plugins.try.case")}
          multiline
          rows={4}
          value={state.request}
          onChange={(value) => setState("request", value)}
          disabled={state.pending}
        />
        <Show when={busy()}>
          <p role="status" class="text-12-regular text-ink-muted">
            {ctx.t("create.busy")}
          </p>
        </Show>
        <Show when={state.error}>
          <p role="alert" class="break-words text-12-regular text-text-danger-base">
            {state.error}
          </p>
        </Show>
      </div>
      <DialogFooter>
        <Button variant="ghost" disabled={state.pending} onClick={props.close}>
          {ctx.t("common.cancel")}
        </Button>
        <Button
          variant="submit"
          disabled={state.pending || busy() || !state.request.trim()}
          onClick={() => void submit()}
        >
          {ctx.t(state.pending ? "plugins.working" : "plugins.try")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
