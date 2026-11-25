import { createMemo, on, onCleanup, For, Show } from "solid-js"
import { sectionHeading } from "@reddb-io/design-system/contracts/section-heading"
import { SectionHeading } from "@reddb-io/design-system/base/SectionHeading"
import { ReactView } from "@opencode/ui/react-view"
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
import { UsageDetails } from "./details.react"
import { fetchSessionExport, sessionExportFilename } from "./export"
import { createSessionContextFormatter } from "./format"
import { createSessionSpending, formatCost } from "./spending"

const heading = sectionHeading({ size: "sm" })

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
  const spend = createSessionSpending(() => props.session)

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
  const cost = createMemo(() => formatCost(spend()?.spent.cost, spend()?.costAssessment, usd().format, ctx.t))

  // The budgets count subagents too; asked again when the family's spend moves.
  const target = createMemo(
    () => (props.session.id ? { sessionID: props.session.id, spent: JSON.stringify(spend()) } : undefined),
    undefined,
    { equals: (a, b) => a?.sessionID === b?.sessionID && a?.spent === b?.spent },
  )
  const budgets = createLatest(target, (input, signal) =>
    props.session.server.client.session.goal.get({ sessionID: input.sessionID }, { signal }),
  )
  const budgetLines = createMemo(() => {
    const current = spend()

    if (!current) return []
    const goal = budgets.latest
    const active = goal?.budget && ["active", "waiting", "paused"].includes(goal.status)

    return [
      ...(hasLimits(current.limits)
        ? [{ label: "stats.budget", lines: describeBudget(current.limits, current.spent) }]
        : []),
      ...(active && goal.budget
        ? [
            {
              label: "stats.goalBudget",
              lines: describeBudget(goal.budget, spentSince(current.spent, goal.spendStart)),
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
    const text = messages().findLast((message) => message.type === "system")?.text

    if (!text) return
    const trimmed = text.trim()

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

  const selected = createMemo(() => {
    const model = info()?.model

    if (!model) return
    const entry = catalogModel(props.session, model)

    return {
      name: entry?.model?.name ?? model.id,
      provider: entry?.provider.name ?? model.providerID,
      limit: entry?.model?.limit,
    }
  })

  const stats = createMemo(() => {
    const usage = context()
    const spending = spend()
    const assessment = spending?.costAssessment?.status
    const partial = assessment === "unknown" && !!spending && spending.spent.cost > 0

    return [
      { term: ctx.t("stats.session"), value: info()?.title ?? (props.session.id || "—") },
      { term: ctx.t("stats.messages"), value: counts().all.toLocaleString(i18n.locale()) },
      { term: ctx.t("stats.selectedProvider"), value: selected()?.provider ?? "—" },
      { term: ctx.t("stats.selectedModel"), value: selected()?.name ?? "—" },
      { term: ctx.t("stats.selectedContext"), value: formatter().number(selected()?.limit?.context || undefined) },
      {
        term: ctx.t("stats.selectedInput"),
        value: formatter().number(selected()?.limit?.input || selected()?.limit?.context || undefined),
      },
      { term: ctx.t("stats.selectedOutput"), value: formatter().number(selected()?.limit?.output || undefined) },
      { term: ctx.t("stats.lastProvider"), value: providerLabel() },
      { term: ctx.t("stats.lastModel"), value: modelLabel() },
      { term: ctx.t("stats.lastContext"), value: formatter().number(usage?.limit) },
      { term: ctx.t("stats.totalTokens"), value: formatter().number(usage?.tokens) },
      {
        term: ctx.t("stats.usage"),
        value: usage ? ContextUsage.format(usage, compact().format) : "—",
        warning: !!usage && ContextUsage.over(usage),
      },
      { term: ctx.t("stats.inputTokens"), value: formatter().number(usage?.message.tokens.input) },
      { term: ctx.t("stats.outputTokens"), value: formatter().number(usage?.message.tokens.output) },
      { term: ctx.t("stats.reasoningTokens"), value: formatter().number(usage?.message.tokens.reasoning) },
      {
        term: ctx.t("stats.cacheTokens"),
        value: `${formatter().number(usage?.message.tokens.cache.read)} / ${formatter().number(usage?.message.tokens.cache.write)}`,
      },
      { term: ctx.t("stats.userMessages"), value: counts().user.toLocaleString(i18n.locale()) },
      { term: ctx.t("stats.assistantMessages"), value: counts().assistant.toLocaleString(i18n.locale()) },
      {
        term: ctx.t(partial ? "stats.knownSubtotal" : "stats.totalCost"),
        value: cost(),
        note: partial
          ? ctx.t("cost.partial")
          : spending && (!assessment || assessment === "legacy")
            ? ctx.t("cost.legacy")
            : assessment === "estimated"
              ? ctx.t("cost.estimated")
              : undefined,
      },
      { term: ctx.t("stats.sessionCreated"), value: formatter().time(info()?.time.created) },
      { term: ctx.t("stats.lastActivity"), value: formatter().time(usage?.message.time.created) },
      ...budgetLines().map((budget) => ({ term: ctx.t(budget.label), value: budget.lines.join("\n") })),
    ]
  })

  const exportSession = async () => {
    const sessionID = props.session.id

    if (!sessionID) return

    try {
      const exported = await fetchSessionExport({
        sessionID,
        api: props.session.server.client,
      })

      const filename = sessionExportFilename(exported.info)

      if (!(await system.save({ name: filename, content: JSON.stringify(exported, null, 2) }))) return
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
        <ReactView component={UsageDetails} props={{ entries: stats() }} />

        <Show when={systemPrompt()}>
          {(prompt) => (
            <div class="flex flex-col gap-2">
              <ReactView component={SectionHeading} props={{ title: ctx.t("systemPrompt.title"), size: "sm" }} />
              <div class="border border-elevation-base-border rounded-md bg-elevation-sunken-surface px-3 py-2">
                <Markdown text={prompt()} class="text-12-regular" />
              </div>
            </div>
          )}
        </Show>

        <div class="flex flex-col gap-2">
          <div class={heading.root()}>
            <h2 class={heading.title()}>{ctx.t("rawMessages.title")}</h2>
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
