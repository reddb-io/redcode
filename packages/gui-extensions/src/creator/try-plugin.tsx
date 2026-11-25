import { ReactView } from "@opencode/ui/react-view"
import { useNativeDialog } from "@opencode/ui/context/dialog"
import { CreatorRequestDialog } from "./request-dialog.react"
import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useExtension, type SessionRef } from "../sdk"
import type definition from "./index"

export default function TryPlugin(props: {
  session: SessionRef
  name: string
  tools: readonly string[]
  close: () => void
}) {
  const ctx = useExtension<typeof definition>()
  const modal = useNativeDialog()
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
    <ReactView
      component={CreatorRequestDialog}
      props={{
        open: modal.open(),
        title: ctx.t("plugins.try.title", { name: props.name }),
        description: ctx.t("plugins.try.description"),
        submitLabel: ctx.t(state.pending ? "plugins.working" : "plugins.try"),
        tools: ctx.t("plugins.tools", { tools: props.tools.join(", ") }),
        requestLabel: ctx.t("plugins.try.case"),
        request: state.request,
        setRequest: (value) => setState("request", value),
        disabled: state.pending || busy() || !state.request.trim(),
        pending: state.pending,
        busyHint: busy() ? ctx.t("create.busy") : undefined,
        error: state.error,
        closeLabel: ctx.t("ui.common.close"),
        cancelLabel: ctx.t("common.cancel"),
        close: props.close,
        submit,
      }}
    />
  )
}
