import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiStatuslineSegment, TuiStatuslineTone } from "@opencode-ai/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, For, Show } from "solid-js"
import path from "path"
import { useRoute } from "../context/route"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { usePluginRuntime } from "../plugin/runtime"
import { fitStatuslineSegments, mergeStatuslineSegments } from "../statusline"
import { useRedskilled } from "../context/redskilled"

function Segment(props: { segment: TuiStatuslineSegment }) {
  const theme = useTheme().theme
  const colors: Record<TuiStatuslineTone, typeof theme.text> = {
    default: theme.text,
    muted: theme.textMuted,
    info: theme.info,
    success: theme.success,
    warning: theme.warning,
    error: theme.error,
  }
  return <text fg={colors[props.segment.tone ?? "default"]}>{props.segment.text}</text>
}

export function Statusline(props: { version: string }) {
  const dimensions = useTerminalDimensions()
  const route = useRoute()
  const sync = useSync()
  const runtime = usePluginRuntime()
  const theme = useTheme().theme
  const redskilled = useRedskilled()

  const base = createMemo(() => {
    const sessionID = route.data.type === "session" ? route.data.sessionID : undefined
    const messages = sessionID ? (sync.data.message[sessionID] ?? []) : []
    const last = messages.findLast(
      (item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0,
    )
    const tokens = last
      ? last.tokens.input +
        last.tokens.output +
        last.tokens.reasoning +
        last.tokens.cache.read +
        last.tokens.cache.write
      : 0
    const model = last
      ? sync.data.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
      : undefined
    const diff = sessionID ? (sync.data.session_diff[sessionID] ?? []) : []
    const additions = diff.reduce((total, item) => total + (item.additions ?? 0), 0)
    const deletions = diff.reduce((total, item) => total + (item.deletions ?? 0), 0)
    const mcp = Object.values(sync.data.mcp)
    const connected = mcp.filter((item) => item.status === "connected").length
    const failed = mcp.some((item) => item.status === "failed")
    return [
      {
        id: "project",
        text: `${path.basename(sync.path.directory)}${sync.data.vcs?.branch ? ` (${sync.data.vcs.branch})` : ""}`,
        short: path.basename(sync.path.directory),
        tone: "muted",
        importance: "required",
        order: 10,
      },
      {
        id: "version",
        text: `v${props.version}`,
        tone: "muted",
        importance: "optional",
        order: 20,
      },
      ...(last
        ? [
            {
              id: "model",
              text: last.modelID,
              short: last.modelID.split("/").at(-1),
              importance: "normal" as const,
              order: 30,
            },
          ]
        : []),
      ...(tokens && model?.limit.context
        ? [
            {
              id: "context",
              text: `ctx ${Math.round((tokens / model.limit.context) * 100)}%`,
              importance: "normal" as const,
              order: 40,
            },
          ]
        : []),
      ...(additions || deletions
        ? [
            {
              id: "diff",
              text: `+${additions} -${deletions}`,
              tone: "warning" as const,
              importance: "normal" as const,
              order: 50,
            },
          ]
        : []),
      ...(mcp.length
        ? [
            {
              id: "mcp",
              text: `${failed ? "!" : ""}${connected} MCP`,
              tone: failed ? ("error" as const) : ("success" as const),
              importance: "optional" as const,
              order: 90,
            },
          ]
        : []),
      ...(redskilled.status()
        ? [
            {
              id: "redskilled",
              text: redskilled.status()?.render?.line || `rsk ${redskilled.status()?.payload?.host.worker_count ?? 0}w`,
              short: `rsk ${redskilled.status()?.payload?.host.worker_count ?? 0}`,
              tone:
                redskilled.status()?.lifecycle === "live"
                  ? ("success" as const)
                  : redskilled.status()?.lifecycle === "degraded"
                    ? ("warning" as const)
                    : ("muted" as const),
              importance: "normal" as const,
              order: 80,
            },
          ]
        : []),
    ] satisfies TuiStatuslineSegment[]
  })

  const header = createMemo(() =>
    fitStatuslineSegments(
      mergeStatuslineSegments(
        base(),
        runtime.statusline().map((item) => item.contribution.segments ?? []),
      ),
      Math.max(1, dimensions().width - 4),
    ),
  )

  const rows = createMemo(() =>
    runtime
      .statusline()
      .flatMap((item) => item.contribution.rows ?? [])
      .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  )

  return (
    <box width="100%" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="column">
      <box flexDirection="row" gap={1}>
        <For each={header()}>
          {(item, index) => (
            <>
              <Show when={index() > 0}>
                <text fg={theme.textMuted}>·</text>
              </Show>
              <Segment segment={item} />
            </>
          )}
        </For>
      </box>
      <For each={rows()}>
        {(row) => (
          <box flexDirection="row" gap={1}>
            <For each={fitStatuslineSegments(row.segments, Math.max(1, dimensions().width - 4))}>
              {(item, index) => (
                <>
                  <Show when={index() > 0}>
                    <text fg={theme.textMuted}>·</text>
                  </Show>
                  <Segment segment={item} />
                </>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}
