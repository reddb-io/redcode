import { Show, createMemo, type ComponentProps, type JSX } from "solid-js"
import { ProgressCircle } from "@opencode/ui/progress-circle"
import { Tooltip } from "@opencode/ui/tooltip"
import { createMediaQuery } from "@solid-primitives/media"
import type { SessionMessageAssistant } from "@opencode/client/promise"
import { GenerationTiming } from "@opencode/util/generation-timing"

import { useFile } from "@/workspaces/files/model"
import { useLayout } from "@/shell/state/layout"
import { useData } from "@/runtime/server/current"
import { useLanguage } from "@/runtime/i18n/language"
import { useProviders } from "@/providers/catalog/providers"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useSessionLayout } from "@/session/session-layout"
import { createSessionTabs } from "@/session/helpers"

interface SessionContextUsageProps {
  variant?: "button" | "indicator"
  placement?: ComponentProps<typeof Tooltip>["placement"]
}

function ContextTooltipRow(props: { name: JSX.Element; value: JSX.Element }) {
  return (
    <div class="flex min-w-0 items-center gap-4">
      <span class="shrink-0 text-ink-muted">{props.name}</span>
      <span class="ml-auto min-w-0 truncate text-right tabular-nums text-foreground">{props.value}</span>
    </div>
  )
}

function openSessionContext(args: {
  view: ReturnType<ReturnType<typeof useLayout>["view"]>
  layout: ReturnType<typeof useLayout>
  tabs: ReturnType<ReturnType<typeof useLayout>["tabs"]>
}) {
  args.view.reviewPanel.open(args.view.reviewPanel.opened() ? "other" : "context-button")
  if (args.layout.fileTree.opened() && args.layout.fileTree.tab() !== "all") args.layout.fileTree.setTab("all")
  void args.tabs.open("context").then(() => args.tabs.setActive("context"))
}

export function SessionContextUsage(props: SessionContextUsageProps) {
  const data = useData()
  const file = useFile()
  const layout = useLayout()
  const language = useLanguage()
  const sdk = useWorkspaceLocation()
  const providers = useProviders(() => sdk().directory)
  const { params, tabs, view } = useSessionLayout()
  const isDesktop = createMediaQuery("(min-width: 768px)")

  const variant = createMemo(() => props.variant ?? "button")
  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
    fileBrowser: () => isDesktop() && !!params.id,
  })
  const messages = createMemo(() => (params.id ? data.session.message.list(params.id) : []))
  const info = createMemo(() => (params.id ? data.session.get(params.id) : undefined))

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(language.intl(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const context = createMemo(() => {
    const message = messages().findLast((item) => item.type === "assistant" && !!item.tokens)
    if (message?.type !== "assistant" || !message.tokens) return
    const model = providers.all().get(message.model.providerID)?.models[message.model.id]
    const total =
      message.tokens.input +
      message.tokens.output +
      message.tokens.reasoning +
      message.tokens.cache.read +
      message.tokens.cache.write
    return {
      total,
      usage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
    }
  })
  // The latest step that streamed anything, read with the same rules as the TUI sidebar.
  const timing = createMemo(() => {
    const message = messages().findLast(
      (item): item is SessionMessageAssistant => item.type === "assistant" && item.time.first !== undefined,
    )
    return message ? GenerationTiming.step(message) : undefined
  })
  const compact = createMemo(
    () => new Intl.NumberFormat(language.intl(), { notation: "compact", maximumFractionDigits: 1 }),
  )
  const cost = createMemo(() => {
    return usd().format(info()?.cost ?? 0)
  })
  // The header's status line: context use (or tokens when the model's window is unknown) and the session cost.
  const status = createMemo(() => {
    const value = context()
    const usage =
      value?.usage !== null && value?.usage !== undefined
        ? `${value.usage}%`
        : value?.total
          ? compact().format(value.total)
          : undefined
    return [usage, cost()].filter(Boolean).join(" · ")
  })
  const contextVisible = createMemo(() => view().reviewPanel.opened() && tabState.activeTab() === "context")
  const hasOtherTabs = createMemo(() =>
    tabs()
      .all()
      .some((tab) => tab !== "context" && tab !== "review"),
  )

  const openContext = () => {
    if (!params.id) return

    const sessionView = view()
    if (contextVisible()) {
      tabs().close("context")
      if (sessionView.reviewPanel.source() === "context-button" && !hasOtherTabs()) sessionView.reviewPanel.close()
      return
    }

    openSessionContext({
      view: sessionView,
      layout,
      tabs: tabs(),
    })
  }

  const circle = () => (
    <div class="flex items-center justify-center">
      <ProgressCircle
        appearance="indicator"
        size={16}
        strokeWidth={2}
        percentage={context()?.usage ?? 0}
        style={{
          "--progress-circle-background": "var(--reddb-color-muted)",
          "--progress-circle-background-overlay": "transparent",
          "--progress-circle-progress": "var(--reddb-color-foreground)",
        }}
      />
    </div>
  )
  const compactCircle = () => (
    <div class="flex items-center justify-center">
      <ProgressCircle appearance="compact" percentage={context()?.usage ?? 0} />
    </div>
  )

  const tooltipValue = () => (
    <div class="flex w-[120px] flex-col gap-2">
      <ContextTooltipRow name={language.t("context.usage.cost")} value={cost()} />
      <ContextTooltipRow name={language.t("context.usage.usage")} value={`${context()?.usage ?? 0}%`} />
      <ContextTooltipRow
        name={language.t("context.usage.tokens")}
        value={context()?.total.toLocaleString(language.intl()) ?? "0"}
      />
      <Show when={timing()}>
        {(step) => (
          <>
            <ContextTooltipRow
              name={language.t("context.usage.latency")}
              value={GenerationTiming.formatLatency(step().latency, language.intl())}
            />
            <Show when={step().speed}>
              {(speed) => (
                <ContextTooltipRow
                  name={language.t("context.usage.speed")}
                  value={GenerationTiming.formatRate(speed(), language.intl())}
                />
              )}
            </Show>
          </>
        )}
      </Show>
    </div>
  )

  return (
    <Show when={params.id}>
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
              aria-label={language.t("context.usage.view")}
              aria-pressed={contextVisible()}
            >
              {compactCircle()}
              <span aria-hidden="true" class="hidden sm:inline">
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
