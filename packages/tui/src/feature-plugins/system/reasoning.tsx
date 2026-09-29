import type { IntelligenceStatus } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import { createResource, createSignal, onCleanup, Show } from "solid-js"
import { useLocal } from "../../context/local"
import { DialogDesignList } from "../../component/dialog-design-list"
import { DialogIntelligence } from "../../component/dialog-intelligence"
import { configureReasoning } from "../../component/reasoning-setup"
import { errorMessage } from "../../util/error"

export default Plugin.define({
  id: "redcode.reasoning",
  setup(context) {
    const [status, { refetch }] = createResource(() => context.client["server.intelligence"].status())
    const timer = setInterval(() => void refetch(), 60_000)
    onCleanup(() => clearInterval(timer))
    const [busy, setBusy] = createSignal(false)
    context.ui.slot({
      append: "app",
      render() {
        const local = useLocal()
        const setup = () => {
          if (busy()) return
          setBusy(true)
          void configureReasoning(context, (settings) => {
            void local.model.refreshDefault()
            if (settings.principal)
              local.model.set(
                { providerID: settings.principal.providerID, modelID: settings.principal.id },
                { recent: true },
              )
            void refetch()
          })
            .catch((error) => context.ui.toast.show({ variant: "error", message: errorMessage(error), duration: 7000 }))
            .finally(() => setBusy(false))
        }
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "intelligence.setup",
              title: "Configure S1 / S2",
              group: "Provider",
              palette: true,
              slash: { name: "setup" },
              run: setup,
            },
            {
              id: "intelligence.status",
              title: "S1 / S2 models and evaluations",
              group: "Provider",
              palette: true,
              slash: { name: "intelligence" },
              run: () => context.ui.dialog.show(() => <DialogIntelligence context={context} setup={setup} />),
            },
            {
              id: "agent.design",
              title: "Switch to Design mode",
              group: "Agent",
              palette: true,
              slash: { name: "design" },
              run() {
                local.agent.set("design")
                context.ui.dialog.clear()
              },
            },
            {
              id: "design.open",
              title: "Resume Design conversation",
              group: "Session",
              palette: true,
              slash: { name: "design-open" },
              run: () => context.ui.dialog.show(() => <DialogDesignList context={context} />),
            },
            {
              id: "design.review",
              title: "Open Design browser review",
              group: "Session",
              palette: true,
              slash: { name: "design-review" },
              enabled: () => context.ui.router.current().type === "session",
              run: () => context.ui.dialog.show(() => <DialogDesignList context={context} review />),
            },
          ],
        }))
        return null
      },
    })
    context.ui.slot({
      append: "prompt.footer.status",
      render: (props) => (
        <IntelligenceIndicator
          context={context}
          sessionID={props.sessionID}
          status={status.error ? undefined : status()}
          error={Boolean(status.error)}
        />
      ),
    })
  },
})

function IntelligenceIndicator(props: {
  context: Plugin.Context
  sessionID?: string
  status?: IntelligenceStatus
  error: boolean
}) {
  const abort = new AbortController()
  onCleanup(() => abort.abort())
  const [history] = createResource(
    () =>
      props.sessionID
        ? { sessionID: props.sessionID, state: props.context.data.session.status(props.sessionID) }
        : undefined,
    (input) =>
      props.context.client["server.intelligence"].history(
        { sessionID: input.sessionID, limit: 1 },
        { signal: abort.signal },
      ),
  )
  const pending = () => props.status?.settings.onboarding !== "completed"
  const warning = () =>
    props.status?.effective.reasoning === "dual" &&
    (Boolean(history.error) ||
      (!history.error && ["unavailable", "inconclusive", "needs_revision"].includes(history()?.[0]?.decision ?? "")))
  const label = () => {
    if (props.error) return "S1/S2 offline"
    if (!props.status) return ""
    if (pending()) return "S1/S2 setup"
    if (warning()) return "S1 needs attention"
    return ""
  }
  return (
    <Show when={label()}>
      {(value) => (
        <text
          fg={
            props.error || warning() ? props.context.theme.text.feedback.warning.base : props.context.theme.text.muted
          }
          wrapMode="none"
          onMouseUp={() => props.context.keymap.dispatch(pending() ? "intelligence.setup" : "intelligence.status")}
        >
          {value()}
        </text>
      )}
    </Show>
  )
}
