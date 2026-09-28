import type { IntelligenceStatus } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import { createResource, createSignal, onCleanup } from "solid-js"
import { useLocal } from "../../context/local"
import { DialogDesignList } from "../../component/dialog-design-list"
import { DialogIntelligence } from "../../component/dialog-intelligence"
import { configureReasoning } from "../../component/reasoning-setup"
import { errorMessage } from "../../util/error"
import { Locale } from "../../util/locale"

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
    props.error ||
    Boolean(history.error) ||
    (!history.error && ["unavailable", "inconclusive", "needs_revision"].includes(history()?.[0]?.decision ?? ""))
  const model = () => props.context.ui.model.current()
  return (
    <text
      fg={warning() ? props.context.theme.text.feedback.warning.base : props.context.theme.text.muted}
      wrapMode="none"
      onMouseUp={() => props.context.keymap.dispatch(pending() ? "intelligence.setup" : "intelligence.status")}
    >
      {props.error
        ? "S1/S2 offline"
        : pending()
          ? "S1/S2 setup"
          : `S2 ${Locale.truncate(model()?.modelID ?? props.status?.settings.principal?.id ?? "unset", 14)} · S1 ${props.status?.effective.reasoning === "dual" ? Locale.truncate(props.status?.settings.evaluator?.model ?? "unset", 14) : "off"}${warning() ? " !" : ""}`}
    </text>
  )
}
