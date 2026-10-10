import { Show, createMemo, type ComponentProps, type JSX } from "solid-js"
import { ProgressCircle } from "@opencode/ui/progress-circle"
import { Tooltip } from "@opencode/ui/tooltip"
import { useI18n } from "@opencode/ui/context/i18n"
import type { SessionMessageAssistant } from "@opencode/client/promise"
import { ContextUsage } from "@opencode/util/context-usage"
import { GenerationTiming } from "@opencode/util/generation-timing"
import { useExtension, type MountedSession } from "../sdk"
import { readContext, syncCatalog } from "./catalog"

function ContextTooltipRow(props: { name: JSX.Element; value: JSX.Element }) {
  return (
    <div class="flex min-w-0 items-center gap-4">
      <span class="shrink-0 text-ink-muted">{props.name}</span>
      <span class="ml-auto min-w-0 truncate text-right tabular-nums text-foreground">{props.value}</span>
    </div>
  )
}

export function SessionContextUsage(props: {
  session: MountedSession
  variant?: "button" | "indicator"
  placement?: ComponentProps<typeof Tooltip>["placement"]
}) {
  const ctx = useExtension()
  const layout = ctx.layout
  const i18n = useI18n()
  syncCatalog(() => props.session)

  const variant = createMemo(() => props.variant ?? "button")

  const messages = createMemo(() =>
    props.session.id ? props.session.server.data.session.message.list(props.session.id) : [],
  )

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(i18n.locale(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const context = createMemo(() => readContext(props.session, messages()))
  const over = createMemo(() => {
    const value = context()

    return !!value && ContextUsage.over(value)
  })

  // The latest step that streamed anything, read with the same rules as the TUI sidebar.
  const timing = createMemo(() => {
    const message = messages().findLast(
      (item): item is SessionMessageAssistant => item.type === "assistant" && item.time.first !== undefined,
    )
    return message ? GenerationTiming.step(message) : undefined
  })
  const compact = createMemo(
    () => new Intl.NumberFormat(i18n.locale(), { notation: "compact", maximumFractionDigits: 1 }),
  )
  // The whole session family's spend, subagents included, as the TUI footer shows it.
  const cost = createMemo(() =>
    usd().format(props.session.id ? props.session.server.data.session.cost(props.session.id) : 0),
  )
  // The header's status line: context use (or tokens when the model's window is unknown) and the session cost.
  const status = createMemo(() => {
    const value = context()
    const usage =
      value?.percent !== undefined ? `${value.percent}%` : value ? compact().format(value.tokens) : undefined
    return [usage, cost()].filter(Boolean).join(" · ")
  })
  const contextVisible = createMemo(() => layout.state(`${ctx.id}:main`, props.session) === "visible")

  const openContext = () => {
    if (!props.session.id) return
    layout.toggle(`${ctx.id}:main`, props.session)
  }

  const circle = () => (
    <div class="flex items-center justify-center">
      <ProgressCircle
        appearance="indicator"
        size={16}
        strokeWidth={2}
        percentage={context()?.percent ?? 0}
        style={{
          "--progress-circle-background": "var(--reddb-color-muted)",
          "--progress-circle-background-overlay": "transparent",
          "--progress-circle-progress": over()
            ? "var(--reddb-color-feedback-warning-foreground)"
            : "var(--reddb-color-foreground)",
        }}
      />
    </div>
  )

  const compactCircle = () => (
    <div class="flex items-center justify-center">
      <ProgressCircle
        appearance="compact"
        percentage={context()?.percent ?? 0}
        style={over() ? { "--progress-circle-progress": "var(--reddb-color-feedback-warning-foreground)" } : undefined}
      />
    </div>
  )

  const tooltipValue = () => (
    <div class="flex w-[200px] flex-col gap-2">
      <ContextTooltipRow name={ctx.t("usage.cost")} value={cost()} />
      <ContextTooltipRow
        name={ctx.t("usage.usage")}
        value={
          <span classList={{ "text-feedback-warning-foreground": over() }}>
            <Show when={context()} fallback="0%">
              {(value) => ContextUsage.format(value(), compact().format)}
            </Show>
          </span>
        }
      />
      <Show when={over()}>
        <div class="text-feedback-warning-foreground">{ctx.t("usage.over")}</div>
      </Show>
      <ContextTooltipRow name={ctx.t("usage.tokens")} value={(context()?.tokens ?? 0).toLocaleString(i18n.locale())} />
      <Show when={timing()}>
        {(step) => (
          <>
            <ContextTooltipRow
              name={ctx.t("usage.latency")}
              value={GenerationTiming.formatLatency(step().latency, i18n.locale())}
            />
            <Show when={step().speed}>
              {(speed) => (
                <ContextTooltipRow
                  name={ctx.t("usage.speed")}
                  value={GenerationTiming.formatRate(speed(), i18n.locale())}
                />
              )}
            </Show>
          </>
        )}
      </Show>
    </div>
  )

  return (
    <Show when={props.session.id}>
      <Tooltip value={tooltipValue()} placement={props.placement ?? "top"} shift={-8}>
        <Show
          when={variant() === "indicator"}
          fallback={
            <button
              type="button"
              data-component="session-context-usage"
              class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 font-mono text-[12px] leading-text-compact tabular-nums text-ink-muted transition-colors hover:bg-foreground/8 hover:text-foreground active:bg-foreground/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              classList={{ "bg-foreground/10 text-foreground": contextVisible() }}
              onClick={openContext}
              aria-label={ctx.t("usage.view")}
              aria-pressed={contextVisible()}
            >
              {compactCircle()}
              <span
                aria-hidden="true"
                class="hidden sm:inline"
                classList={{ "text-feedback-warning-foreground": over() }}
              >
                {status()}
              </span>
            </button>
          }
        >
          {circle()}
        </Show>
      </Tooltip>
    </Show>
  )
}
