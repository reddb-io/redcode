import { createMemo, createEffect, on, onCleanup, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useSync } from "@/context/sync"
import { checksum } from "@reddb-io/redcode-core/util/encode"
import { findLast } from "@reddb-io/redcode-core/util/array"
import { same } from "@/utils/same"
import { Icon } from "@reddb-io/redcode-ui/icon"
import { Button } from "@reddb-io/redcode-ui/button"
import { Accordion } from "@reddb-io/redcode-ui/accordion"
import { StickyAccordionHeader } from "@reddb-io/redcode-ui/sticky-accordion-header"
import { File } from "@reddb-io/redcode-session-ui/file"
import { Markdown } from "@reddb-io/redcode-session-ui/markdown"
import { ScrollView } from "@reddb-io/redcode-ui/scroll-view"
import type { Message, Part, UserMessage } from "@reddb-io/redcode-sdk/v2/client"
import { showToast } from "@/utils/toast"
import { downloadSessionExport, fetchSessionExport, sessionExportFilename } from "@/utils/session-export"
import { useProviders } from "@/hooks/use-providers"
import { useSDK } from "@/context/sdk"
import { useSessionLayout } from "@/pages/session/session-layout"
import { getSessionContext, formatLatency, formatSpeed } from "./session-context-metrics"
import { estimateSessionContextBreakdown, type SessionContextBreakdownKey } from "./session-context-breakdown"
import { createSessionContextFormatter } from "./session-context-format"

const BREAKDOWN_COLOR: Record<SessionContextBreakdownKey, string> = {
  system: "var(--syntax-info)",
  user: "var(--syntax-success)",
  assistant: "var(--syntax-property)",
  tool: "var(--syntax-warning)",
  other: "var(--syntax-comment)",
}

function Stat(props: { label: string; value: JSX.Element }) {
  return (
    <div class="flex flex-col gap-1">
      <div class="text-12-regular text-text-weak">{props.label}</div>
      <div class="text-12-medium text-text-strong">{props.value}</div>
    </div>
  )
}

function RawMessageContent(props: { message: Message; getParts: (id: string) => Part[]; onRendered: () => void }) {
  const file = createMemo(() => {
    const parts = props.getParts(props.message.id)
    const contents = JSON.stringify({ message: props.message, parts }, null, 2)
    return {
      name: `${props.message.role}-${props.message.id}.json`,
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
  message: Message
  getParts: (id: string) => Part[]
  onRendered: () => void
  time: (value: number | undefined) => string
}) {
  return (
    <Accordion.Item value={props.message.id}>
      <StickyAccordionHeader>
        <Accordion.Trigger>
          <div class="flex items-center justify-between gap-2 w-full">
            <div class="min-w-0 truncate">
              {props.message.role} <span class="text-text-base">• {props.message.id}</span>
            </div>
            <div class="flex items-center gap-3">
              <div class="shrink-0 text-12-regular text-text-weak">{props.time(props.message.time.created)}</div>
              <Icon name="chevron-grabber-vertical" size="small" class="shrink-0 text-text-weak" />
            </div>
          </div>
        </Accordion.Trigger>
      </StickyAccordionHeader>
      <Accordion.Content class="bg-background-base">
        <div class="p-3">
          <RawMessageContent message={props.message} getParts={props.getParts} onRendered={props.onRendered} />
        </div>
      </Accordion.Content>
    </Accordion.Item>
  )
}

const emptyMessages: Message[] = []
const emptyUserMessages: UserMessage[] = []

export function SessionContextTab() {
  const sync = useSync()
  const sdk = useSDK()
  const providers = useProviders(() => sdk().directory)
  const { params, view } = useSessionLayout()

  const info = createMemo(() => (params.id ? sync().session.get(params.id) : undefined))

  const messages = createMemo(
    () => {
      const id = params.id
      if (!id) return emptyMessages
      return (sync().data.message[id] ?? []) as Message[]
    },
    emptyMessages,
    { equals: same },
  )

  const userMessages = createMemo(
    () => messages().filter((m) => m.role === "user") as UserMessage[],
    emptyUserMessages,
    { equals: same },
  )

  const visibleUserMessages = createMemo(
    () => {
      const revert = info()?.revert?.messageID
      if (!revert) return userMessages()
      const boundary = userMessages().findIndex((message) => message.id === revert)
      return boundary < 0 ? userMessages() : userMessages().slice(0, boundary)
    },
    emptyUserMessages,
    { equals: same },
  )

  const usd = createMemo(
    () =>
      new Intl.NumberFormat("en", {
        style: "currency",
        currency: "USD",
      }),
  )

  const ctx = createMemo(() => getSessionContext(messages(), [...providers.all().values()]))
  const formatter = createMemo(() => createSessionContextFormatter("en"))

  const cost = createMemo(() => {
    return usd().format(info()?.cost ?? 0)
  })

  const counts = createMemo(() => {
    const all = messages()
    const user = all.reduce((count, x) => count + (x.role === "user" ? 1 : 0), 0)
    const assistant = all.reduce((count, x) => count + (x.role === "assistant" ? 1 : 0), 0)
    return {
      all: all.length,
      user,
      assistant,
    }
  })

  const systemPrompt = createMemo(() => {
    const msg = findLast(visibleUserMessages(), (m) => !!m.system)
    const system = msg?.system
    if (!system) return
    const trimmed = system.trim()
    if (!trimmed) return
    return trimmed
  })

  const providerLabel = createMemo(() => {
    const c = ctx()
    if (!c) return "—"
    return c.providerLabel
  })

  const modelLabel = createMemo(() => {
    const c = ctx()
    if (!c) return "—"
    return c.modelLabel
  })

  const breakdown = createMemo(
    on(
      () => [ctx()?.message.id, ctx()?.input, messages().length, systemPrompt()],
      () => {
        const c = ctx()
        if (!c?.input) return []
        return estimateSessionContextBreakdown({
          messages: messages(),
          parts: sync().data.part as Record<string, Part[] | undefined>,
          input: c.input,
          systemPrompt: systemPrompt(),
        })
      },
    ),
  )

  const breakdownLabel = (key: SessionContextBreakdownKey) => {
    if (key === "system") return "System"
    if (key === "user") return "User"
    if (key === "assistant") return "Assistant"
    if (key === "tool") return "Tool Calls"
    return "Other"
  }

  // A finished or aborted step's numbers describe the past: dimmed and labeled rather than shown as live.
  const timed = (value: string) => {
    const step = ctx()?.meter?.step
    if (!step?.stale || value === "—") return value
    const note = step.aborted ? "aborted" : "last step"
    return (
      <span class="text-text-weak">
        {value} <span class="text-text-weaker">({note})</span>
      </span>
    )
  }

  const speedLabels = () => ({
    burst: "Not streamed (burst)",
    hidden: "reasoning hidden",
  })

const stats = [
    { label: "Session", value: () => info()?.title ?? params.id ?? "—" },
    { label: "Messages", value: () => counts().all.toLocaleString("en") },
    { label: "Provider", value: providerLabel },
    { label: "Model", value: modelLabel },
    { label: "Context Limit", value: () => formatter().number(ctx()?.limit) },
    { label: "Total Tokens", value: () => formatter().number(ctx()?.total) },
    { label: "Usage", value: () => formatter().percent(ctx()?.usage) },
    { label: "Input Tokens", value: () => formatter().number(ctx()?.input) },
    { label: "Output Tokens", value: () => formatter().number(ctx()?.message.tokens.output) },
    { label: "Reasoning Tokens", value: () => formatter().number(ctx()?.message.tokens.reasoning) },
    {
      label: "Cache Tokens (read/write)",
      value: () =>
        `${formatter().number(ctx()?.message.tokens.cache.read)} / ${formatter().number(ctx()?.message.tokens.cache.write)}`,
    },
    { label: "User Messages", value: () => counts().user.toLocaleString("en") },
    { label: "Assistant Messages", value: () => counts().assistant.toLocaleString("en") },
    { label: "Total Cost", value: cost },
    { label: "Latency (first token)", value: () => timed(formatLatency(ctx()?.meter?.step.latency, "en")) },
    { label: "First visible token", value: () => timed(formatLatency(ctx()?.meter?.step.visible, "en")) },
    {
      label: "Output speed",
      value: () => timed(formatSpeed(ctx()?.meter?.step.speed, "en", speedLabels())),
    },
    {
      label: "Output speed (turn)",
      value: () => {
        const turn = ctx()?.meter?.turn
        const speed = formatSpeed(turn?.speed, "en", speedLabels())
        // Some steps are left out (bursts, too short, unfinished); subagents never count toward the turn.
        if (!turn || speed === "—" || turn.rated === turn.steps) return speed
        return `${speed} · ${`${turn.rated}/${turn.steps} steps rated`}`
      },
    },
    { label: "Local preparation", value: () => formatLatency(ctx()?.meter?.step.prep, "en") },
    { label: "Session Created", value: () => formatter().time(info()?.time.created) },
    { label: "Last Activity", value: () => formatter().time(ctx()?.message.time.created) },
  ] satisfies { label: string; value: () => JSX.Element }[]

  const exportSession = async () => {
    const sessionID = params.id
    if (!sessionID) return
    try {
      const data = await fetchSessionExport({
        sessionID,
        client: sdk().client,
      })
      const filename = sessionExportFilename(data.info)
      downloadSessionExport(filename, data)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "Session exported",
        description: `Saved session to ${filename}`,
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: "Failed to export session",
        description: err instanceof Error ? err.message : "An error occurred while exporting the session",
      })
    }
  }

  let scroll: HTMLDivElement | undefined
  let frame: number | undefined
  let pending: { x: number; y: number } | undefined
  const getParts = (id: string) => (sync().data.part[id] ?? []) as Part[]

  const restoreScroll = () => {
    const el = scroll
    if (!el) return

    const s = view().scroll("context")
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

      view().setScroll("context", next)
    })
  }

  createEffect(
    on(
      () => messages().length,
      () => {
        requestAnimationFrame(restoreScroll)
      },
      { defer: true },
    ),
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
      <div class="px-6 pt-4 pb-10 flex flex-col gap-10">
        <div class="grid grid-cols-1 @[32rem]:grid-cols-2 gap-4">
          <For each={stats}>
            {(stat) => <Stat label={stat.label} value={stat.value()} />}
          </For>
        </div>

        <Show when={breakdown().length > 0}>
          <div class="flex flex-col gap-2">
            <div class="text-12-regular text-text-weak">{"Context Breakdown"}</div>
            <div class="h-2 w-full rounded-full bg-surface-base overflow-hidden flex">
              <For each={breakdown()}>
                {(segment) => (
                  <div
                    class="h-full"
                    style={{
                      width: `${segment.width}%`,
                      "background-color": BREAKDOWN_COLOR[segment.key],
                    }}
                  />
                )}
              </For>
            </div>
            <div class="flex flex-wrap gap-x-3 gap-y-1">
              <For each={breakdown()}>
                {(segment) => (
                  <div class="flex items-center gap-1 text-11-regular text-text-weak">
                    <div class="size-2 rounded-sm" style={{ "background-color": BREAKDOWN_COLOR[segment.key] }} />
                    <div>{breakdownLabel(segment.key)}</div>
                    <div class="text-text-weaker">{segment.percent.toLocaleString("en")}%</div>
                  </div>
                )}
              </For>
            </div>
            <div class="hidden text-11-regular text-text-weaker">{"Approximate breakdown of input tokens. \"Other\" includes tool definitions and overhead."}</div>
          </div>
        </Show>

        <Show when={systemPrompt()}>
          {(prompt) => (
            <div class="flex flex-col gap-2">
              <div class="text-12-regular text-text-weak">{"System Prompt"}</div>
              <div class="border border-border-base rounded-md bg-surface-base px-3 py-2">
                <Markdown text={prompt()} class="text-12-regular" />
              </div>
            </div>
          )}
        </Show>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <div class="text-12-regular text-text-weak">{"Raw messages"}</div>
            <Button
              size="small"
              variant="ghost"
              class="gap-1.5 px-2 text-text-weak hover:text-text-base"
              onClick={exportSession}
            >
              <Icon name="download" size="small" />
              <span>{"Export session"}</span>
            </Button>
          </div>
          <Accordion multiple>
            <For each={messages()}>
              {(message) => (
                <RawMessage message={message} getParts={getParts} onRendered={restoreScroll} time={formatter().time} />
              )}
            </For>
          </Accordion>
        </div>
      </div>
    </ScrollView>
  )
}
