import type { IntelligenceStatus } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import { Satisfaction } from "@opencode/schema/satisfaction"
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
                {
                  providerID: settings.principal.providerID,
                  modelID: settings.principal.id,
                  connection: settings.principal.connection,
                },
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
              title: "Configure dual reasoning (S1 / S2)",
              group: "Provider",
              palette: true,
              slash: { name: "dual", aliases: ["setup"] },
              run: setup,
            },
            {
              id: "intelligence.sessionMode",
              title: "Set reasoning for this session",
              group: "Session",
              palette: true,
              slash: { name: "reasoning" },
              enabled: () => context.ui.router.current().type === "session",
              run: async () => {
                const route = context.ui.router.current()
                if (route.type !== "session") return
                const choice = await context.ui.dialog.select({
                  title: "Session reasoning",
                  options: [
                    { value: "default" as const, title: "Use service default" },
                    { value: "single" as const, title: "Single · S2 only" },
                    { value: "observe" as const, title: "Observe · S1 records without intervening" },
                    { value: "dual" as const, title: "Dual · S1 evaluates S2" },
                  ],
                })
                if (!choice) return
                await context.client["server.intelligence"]
                  .sessionMode({ sessionID: route.sessionID, reasoning: choice === "default" ? null : choice })
                  .then(async () => {
                    context.data.session.invalidate(route.sessionID)
                    await context.data.session.sync(route.sessionID)
                    await refetch()
                  })
                  .catch((error) => context.ui.toast.show({ variant: "error", message: errorMessage(error) }))
              },
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
              id: "satisfaction.toggle",
              title: "Show or hide the satisfaction indicator",
              group: "Provider",
              palette: true,
              slash: { name: "satisfaction" },
              run: () => {
                const [view, update] = context.storage.store("satisfaction", { initial: { hidden: false } })
                void update((draft) => {
                  draft.hidden = !draft.hidden
                }).then(() =>
                  context.ui.toast.show({
                    variant: "info",
                    message: view.hidden ? "Satisfaction indicator hidden." : "Satisfaction indicator shown.",
                  }),
                )
              },
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
    context.ui.slot({
      append: "sidebar.header",
      render: (props) => (
        <SatisfactionIndicator
          context={context}
          sessionID={props.sessionID}
          status={status.error ? undefined : status()}
        />
      ),
    })
  },
})

/**
 * How the user is taking the session: five half-blocks on a 0..5 scale, read from what
 * System One classifies for each prompt. Dual reasoning shows progress until enough prompts were read.
 */
function SatisfactionIndicator(props: { context: Plugin.Context; sessionID?: string; status?: IntelligenceStatus }) {
  const abort = new AbortController()
  onCleanup(() => abort.abort())
  const [view] = props.context.storage.store("satisfaction", { initial: { hidden: false } })
  const mode = () =>
    (props.sessionID ? props.context.data.session.get(props.sessionID)?.metadata?.reasoning : undefined) ??
    props.status?.effective.reasoning
  const enabled = () => !view.hidden && mode() === "dual"
  const [history] = createResource(
    () =>
      enabled() && props.sessionID
        ? { sessionID: props.sessionID, state: props.context.data.session.status(props.sessionID) }
        : undefined,
    async (input) => {
      const evaluations = await props.context.client["server.intelligence"]
        .history({ sessionID: input.sessionID, limit: 100 }, { signal: abort.signal })
        .catch(() => undefined)
      if (!evaluations) return undefined
      // Too few prompts read to show anything: the guard log would not change that, so it is not asked for.
      if (
        evaluations.filter((item) => item.operation === "prompt_classification" && item.mode !== "observe").length <
        Satisfaction.MINIMUM
      )
        return { evaluations, trips: [] }
      // What the work showed: turns the harness ended and work that resumed after a hint, since the oldest prompt read.
      const since = Math.min(Infinity, ...evaluations.map((evaluation) => evaluation.created))
      const report = await props.context.client.debug
        .guards({ since: Number.isFinite(since) ? since : 0, limit: 200 }, { signal: abort.signal })
        .catch(() => undefined)
      return { evaluations, trips: report?.recent.filter((trip) => trip.sessionID === input.sessionID) ?? [] }
    },
  )
  const reading = () =>
    enabled() && history() ? Satisfaction.read(history()?.evaluations ?? [], history()?.trips ?? []) : undefined
  const level = () => {
    const value = reading()
    return value ? Math.round((value.mood + 1) * 2.5) : undefined
  }
  const tone = (stage: Satisfaction.Stage) => {
    const feedback = props.context.theme.text.feedback
    if (stage === "frustrated") return feedback.error.base
    if (stage === "rough") return feedback.warning.base
    if (stage === "great") return feedback.success.base
    if (stage === "good") return feedback.info.base
    return props.context.theme.text.base
  }
  // Unknown satisfaction is distinct from a measured zero.
  const waiting = () => {
    if (!enabled() || reading()) return undefined
    if (!history()) return history.loading ? "mood …" : "mood unavailable"
    return "mood ▄▄▄▄▄ ?/5"
  }
  return (
    <Show
      when={reading()}
      fallback={
        <Show when={waiting()}>
          {(value) => (
            <text
              id="session-satisfaction-indicator"
              fg={props.context.theme.text.muted}
              wrapMode="none"
              flexShrink={0}
              onMouseUp={() => props.context.keymap.dispatch("intelligence.status")}
            >
              {value()}
            </text>
          )}
        </Show>
      }
    >
      {(value) => (
        <text
          id="session-satisfaction-indicator"
          fg={props.context.theme.text.muted}
          wrapMode="none"
          flexShrink={0}
          onMouseUp={() => props.context.keymap.dispatch("intelligence.status")}
        >
          mood <span style={{ fg: tone(value().stage) }}>{"▄".repeat(level() ?? 0)}</span>
          <span style={{ fg: props.context.theme.text.muted }}>{"▄".repeat(5 - (level() ?? 0))}</span> {level()}/5
        </text>
      )}
    </Show>
  )
}

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
  const [scoped] = createResource(
    () =>
      props.sessionID
        ? {
            sessionID: props.sessionID,
            reasoning: props.context.data.session.get(props.sessionID)?.metadata?.reasoning,
          }
        : undefined,
    (input) =>
      props.context.client["server.intelligence"].status({ sessionID: input.sessionID }, { signal: abort.signal }),
  )
  const mode = () => scoped()?.effective.reasoning ?? props.status?.effective.reasoning
  const pending = () => props.status?.settings.onboarding !== "completed"
  // What the session's latest evaluation says, in words that do not read as an outage unless S1 truly was unreachable.
  const outcome = () => {
    if (mode() !== "dual") return undefined
    if (history.error) return "unavailable" as const
    const decision = history()?.[0]?.decision
    if (decision === "unavailable" || decision === "inconclusive" || decision === "needs_revision") return decision
    return undefined
  }
  const label = () => {
    if (props.error) return "S1/S2 offline"
    if (!props.status) return ""
    if (pending()) return "S1/S2 setup"
    if (mode() === "observe") return "S1 observing"
    const value = outcome()
    if (value === "unavailable") return "S1 unavailable"
    if (value === "inconclusive") return "S1 unsure"
    if (value === "needs_revision") return "S1 flagged answer"
    return ""
  }
  // Only a real outage takes the warning colour: a flagged or unsure answer is S1 working, not S1 broken.
  const tone = () => {
    if (props.error || outcome() === "unavailable") return props.context.theme.text.feedback.warning.base
    if (outcome()) return props.context.theme.text.feedback.info.base
    return props.context.theme.text.muted
  }
  return (
    <Show when={label()}>
      {(value) => (
        <text
          fg={tone()}
          wrapMode="none"
          onMouseUp={() => props.context.keymap.dispatch(pending() ? "intelligence.setup" : "intelligence.status")}
        >
          {value()}
        </text>
      )}
    </Show>
  )
}
