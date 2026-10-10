import { createMemo, on, onCleanup, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { checksum } from "@opencode/util/encode"
import { Icon } from "@opencode/ui/icon"
import { Button } from "@opencode/ui/button"
import { Accordion } from "@opencode/ui/accordion"
import { StickyAccordionHeader } from "@opencode/ui/sticky-accordion-header"
import { ScrollView } from "@opencode/ui/scroll-view"
import { showToast } from "@opencode/ui/toast"
import { useI18n } from "@opencode/ui/context/i18n"
import { File } from "@opencode/session-ui/file"
import { Markdown } from "@opencode/session-ui/markdown"
import type { SessionBudgetLimits, SessionBudgetTotals, SessionMessageInfo } from "@opencode/client/promise"
import { ContextUsage } from "@opencode/util/context-usage"
import { createKeyed, createLatest, useExtension, type MountedSession } from "../sdk"
import { catalogModel, readContext, syncCatalog } from "./catalog"
import { fetchSessionExport, sessionExportFilename } from "./export"
import { createSessionContextFormatter } from "./format"

function Stat(props: { label: string; value: JSX.Element }) {
  return (
    <div class="flex min-w-0 flex-col gap-1 border-t border-elevation-base-border pt-2">
      <div class="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">{props.label}</div>
      <div class="truncate font-mono text-[13px] tabular-nums text-foreground">{props.value}</div>
    </div>
  )
}

function RawMessageContent(props: { message: SessionMessageInfo; onRendered: () => void }) {
  const file = createMemo(() => {
    const contents = JSON.stringify(props.message, null, 2)

    return {
      name: `${props.message.type}-${props.message.id}.json`,
      contents,
      cacheKey: checksum(contents),
    }
  })

  return (
    <File
      mode="text"
      file={file()}
      overflow="wrap"
      class="select-text"
      onRendered={() => requestAnimationFrame(props.onRendered)}
    />
  )
}

function RawMessage(props: {
  message: SessionMessageInfo
  onRendered: () => void
  time: (value: number | undefined) => string
}) {
  return (
    <Accordion.Item value={props.message.id}>
      <StickyAccordionHeader>
        <Accordion.Trigger>
          <div class="flex items-center justify-between gap-2 w-full">
            <div class="min-w-0 truncate font-mono text-[12px]">
              {props.message.type} <span class="text-ink-muted">• {props.message.id}</span>
            </div>
            <div class="flex items-center gap-3">
              <div class="shrink-0 text-caption tabular-nums text-ink-muted">
                {props.time(props.message.time.created)}
              </div>
              <Icon name="chevron-grabber-vertical" size="small" class="shrink-0 text-ink-muted" />
            </div>
          </div>
        </Accordion.Trigger>
      </StickyAccordionHeader>
      <Accordion.Content class="bg-elevation-sunken-surface">
        <div class="p-3">
          <RawMessageContent message={props.message} onRendered={props.onRendered} />
        </div>
      </Accordion.Content>
    </Accordion.Item>
  )
}

const emptyMessages: SessionMessageInfo[] = []

export default function SessionContextTab(props: { session: MountedSession }) {
  const ctx = useExtension()
  const layout = ctx.layout
  const system = ctx.system
  const i18n = useI18n()
  const data = () => props.session.server.data
  syncCatalog(() => props.session)

  const info = createMemo(() => (props.session.id ? data().session.get(props.session.id) : undefined))

  const messages = createMemo(
    () => {
      const id = props.session.id

      if (!id) return emptyMessages

      return data().session.message.list(id)
    },
    emptyMessages,
    { equals: same },
  )

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(i18n.locale(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const context = createMemo(() => {
    const usage = readContext(props.session, messages())

    if (!usage) return
    const message = usage.message
    const entry = catalogModel(props.session, message.model)

    return {
      ...usage,
      providerLabel: entry?.provider.name ?? message.model.providerID,
      modelLabel: entry?.model?.name ?? message.model.id,
    }
  })

  const formatter = createMemo(() => createSessionContextFormatter(i18n.locale()))
  const compact = createMemo(
    () => new Intl.NumberFormat(i18n.locale(), { notation: "compact", maximumFractionDigits: 1 }),
  )

  // The whole session family's spend, subagents included, as the TUI sidebar shows it.
  const spent = createMemo(() => (props.session.id ? data().session.cost(props.session.id) : 0))
  const cost = createMemo(() => usd().format(spent()))

  // The budgets count subagents too; asked again when the family's spend moves.
  const target = createMemo(
    () => (props.session.id ? { sessionID: props.session.id, spent: spent() } : undefined),
    undefined,
    { equals: (a, b) => a?.sessionID === b?.sessionID && a?.spent === b?.spent },
  )
  const budgets = createLatest(target, (input, signal) =>
    Promise.all([
      props.session.server.client.session.budget.get({ sessionID: input.sessionID }, { signal }),
      props.session.server.client.session.goal.get({ sessionID: input.sessionID }, { signal }),
    ]).then(([view, goal]) => ({ view, goal })),
  )
  const budgetLines = createMemo(() => {
    const current = budgets.latest

    if (!current) return []
    const goal = current.goal
    const active = goal?.budget && ["active", "waiting", "paused"].includes(goal.status)

    return [
      ...(hasLimits(current.view.limits)
        ? [{ label: "stats.budget", lines: describeBudget(current.view.limits, current.view.spent) }]
        : []),
      ...(active && goal.budget
        ? [
            {
              label: "stats.goalBudget",
              lines: describeBudget(goal.budget, spentSince(current.view.spent, goal.spendStart)),
            },
          ]
        : []),
    ]
  })

  const describeBudget = (limits: SessionBudgetLimits, totals: SessionBudgetTotals) => {
    const reached =
      (limits.maxCostUsd !== undefined && totals.cost >= limits.maxCostUsd) ||
      (limits.maxTokens !== undefined && totals.tokens >= limits.maxTokens)
    const lines = [
      ...(limits.maxCostUsd === undefined
        ? []
        : [
            ctx.t(totals.unpriced > 0 ? "budget.costUnknown" : "budget.cost", {
              spent: usd().format(totals.cost),
              limit: usd().format(limits.maxCostUsd),
            }),
          ]),
      ...(limits.maxTokens === undefined
        ? []
        : [
            ctx.t("budget.tokens", {
              spent: totals.tokens.toLocaleString(i18n.locale()),
              limit: limits.maxTokens.toLocaleString(i18n.locale()),
            }),
          ]),
    ]

    return reached ? [...lines, ctx.t("budget.reached")] : lines
  }

  const counts = createMemo(() => {
    const all = messages()
    const user = all.reduce((count, message) => count + (message.type === "user" ? 1 : 0), 0)
    const assistant = all.reduce((count, message) => count + (message.type === "assistant" ? 1 : 0), 0)

    return {
      all: all.length,
      user,
      assistant,
    }
  })

  const systemPrompt = createMemo(() => {
    const system = messages().findLast((message) => message.type === "system")?.text

    if (!system) return
    const trimmed = system.trim()

    if (!trimmed) return

    return trimmed
  })

  const providerLabel = createMemo(() => {
    const c = context()

    if (!c) return "—"

    return c.providerLabel
  })

  const modelLabel = createMemo(() => {
    const c = context()

    if (!c) return "—"

    return c.modelLabel
  })

  const stats = [
    { label: "stats.session", value: () => info()?.title ?? (props.session.id || "—") },
    { label: "stats.messages", value: () => counts().all.toLocaleString(i18n.locale()) },
    { label: "stats.provider", value: providerLabel },
    { label: "stats.model", value: modelLabel },
    { label: "stats.limit", value: () => formatter().number(context()?.limit) },
    { label: "stats.totalTokens", value: () => formatter().number(context()?.tokens) },
    {
      label: "stats.usage",
      value: () => (
        <Show when={context()} fallback="—">
          {(value) => (
            <span classList={{ "text-feedback-warning-foreground": ContextUsage.over(value()) }}>
              {ContextUsage.format(value(), compact().format)}
            </span>
          )}
        </Show>
      ),
    },
    { label: "stats.inputTokens", value: () => formatter().number(context()?.message.tokens.input) },
    { label: "stats.outputTokens", value: () => formatter().number(context()?.message.tokens.output) },
    { label: "stats.reasoningTokens", value: () => formatter().number(context()?.message.tokens.reasoning) },
    {
      label: "stats.cacheTokens",
      value: () =>
        `${formatter().number(context()?.message.tokens.cache.read)} / ${formatter().number(context()?.message.tokens.cache.write)}`,
    },
    { label: "stats.userMessages", value: () => counts().user.toLocaleString(i18n.locale()) },
    { label: "stats.assistantMessages", value: () => counts().assistant.toLocaleString(i18n.locale()) },
    { label: "stats.totalCost", value: cost },
    { label: "stats.sessionCreated", value: () => formatter().time(info()?.time.created) },
    { label: "stats.lastActivity", value: () => formatter().time(context()?.message.time.created) },
  ] satisfies { label: string; value: () => JSX.Element }[]

  const exportSession = async () => {
    const sessionID = props.session.id

    if (!sessionID) return

    try {
      const data = await fetchSessionExport({
        sessionID,
        api: props.session.server.client,
      })

      const filename = sessionExportFilename(data.info)

      if (!(await system.save({ name: filename, content: JSON.stringify(data, null, 2) }))) return
      showToast({
        variant: "success",
        // Solid resolves JSX accessors under the toast's render owner, not this imperative call site.
        icon: () => <Icon name="circle-check" />,
        title: ctx.t("export.success.title"),
        description: ctx.t("export.success.description", { filename }),
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: ctx.t("export.failed.title"),
        description: err instanceof Error ? err.message : ctx.t("export.failed.description"),
      })
    }
  }

  let scroll: HTMLDivElement | undefined
  let frame: number | undefined
  let pending: { x: number; y: number } | undefined

  const restoreScroll = () => {
    const el = scroll

    if (!el) return

    const s = layout.scroll.get(props.session, "context")

    if (!s) return

    if (el.scrollTop !== s.y) el.scrollTop = s.y

    if (el.scrollLeft !== s.x) el.scrollLeft = s.x
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    pending = {
      x: event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    }

    if (frame !== undefined) return

    frame = requestAnimationFrame(() => {
      frame = undefined

      const next = pending
      pending = undefined

      if (!next) return

      layout.scroll.set(props.session, "context", next)
    })
  }

  // Restores the stored scroll a frame after the messages change; on mount the viewport ref restores it.
  createKeyed(
    createMemo(on(messages, (list) => list, { defer: true })),
    () => void requestAnimationFrame(restoreScroll),
  )

  onCleanup(() => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
  })

  return (
    <ScrollView
      class="@container h-full"
      viewportRef={(el) => {
        scroll = el
        restoreScroll()
      }}
      onScroll={handleScroll}
    >
      <div data-slot="session-usage-content" class="px-4 pt-4 pb-6 flex flex-col gap-6 md:px-6 md:pb-10 md:gap-10">
        <div class="grid grid-cols-1 @[32rem]:grid-cols-2 @[48rem]:grid-cols-3 gap-x-6 gap-y-4">
          <For each={stats}>{(stat) => <Stat label={ctx.t(stat.label)} value={stat.value()} />}</For>
          <For each={budgetLines()}>
            {(budget) => (
              <Stat
                label={ctx.t(budget.label)}
                value={
                  <span class="flex flex-col whitespace-normal">
                    <For each={budget.lines}>{(line) => <span>{line}</span>}</For>
                  </span>
                }
              />
            )}
          </For>
        </div>

        <Show when={systemPrompt()}>
          {(prompt) => (
            <div class="flex flex-col gap-2">
              <div class="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
                {ctx.t("systemPrompt.title")}
              </div>
              <div class="border border-elevation-base-border rounded-md bg-elevation-sunken-surface px-3 py-2">
                <Markdown text={prompt()} class="text-12-regular" />
              </div>
            </div>
          )}
        </Show>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <div class="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
              {ctx.t("rawMessages.title")}
            </div>
            <Button
              size="small"
              variant="ghost"
              class="gap-1.5 px-2 text-ink-muted hover:text-foreground"
              onClick={exportSession}
            >
              <Icon name="download" size="small" />
              <span>{ctx.t("export.session")}</span>
            </Button>
          </div>
          <Accordion multiple>
            <For each={messages()}>
              {(message) => <RawMessage message={message} onRendered={restoreScroll} time={formatter().time} />}
            </For>
          </Accordion>
        </div>
      </div>
    </ScrollView>
  )
}

function hasLimits(limits: SessionBudgetLimits) {
  return limits.maxCostUsd !== undefined || limits.maxTokens !== undefined
}

// A goal's budget counts only what the family spent since the goal started.
function spentSince(total: SessionBudgetTotals, start: SessionBudgetTotals | undefined) {
  if (!start) return total

  return {
    cost: Math.max(0, total.cost - start.cost),
    tokens: Math.max(0, total.tokens - start.tokens),
    unpriced: Math.max(0, total.unpriced - start.unpriced),
  }
}

function same<T>(a: readonly T[] | undefined, b: readonly T[] | undefined) {
  if (a === b) return true

  if (!a || !b) return false

  if (a.length !== b.length) return false

  return a.every((x, i) => x === b[i])
}
