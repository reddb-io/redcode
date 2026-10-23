import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createMemo, createSignal, Match, Show, Switch } from "solid-js"
import { contextUsage, formatContextUsage } from "../../util/session"
import { useTerminalDimensions } from "@opentui/solid"
import { stringWidth } from "../../util/string-width"
import { formatCost } from "../../util/cost"

export function PromptFooter(props: {
  context: Plugin.Context
  sessionID?: string
  mode: "normal" | "shell"
  showDetails: boolean
}) {
  const dimensions = useTerminalDimensions()
  createEffect(() => {
    if (props.sessionID) void props.context.data.session.spend.sync(props.sessionID).catch(() => undefined)
  })
  const [liveHovered, setLiveHovered] = createSignal(false)
  const subagents = createMemo(() => {
    if (!props.sessionID) return 0
    const count = props.context.data.session
      .family(props.sessionID)
      .filter((id) => id !== props.sessionID && props.context.data.session.status(id) === "running").length
    return count ? `${count} subagent${count === 1 ? "" : "s"}` : undefined
  })
  const shells = createMemo(() => {
    if (!props.sessionID) return 0
    const count = props.context.data.shell
      .list(props.context.location)
      .filter((shell) => shell.metadata.sessionID === props.sessionID).length
    return count ? `${count} shell${count === 1 ? "" : "s"}` : undefined
  })
  const status = createMemo(() => {
    if (!props.sessionID) return []
    const session = props.context.data.session.get(props.sessionID)
    if (!session) return []
    const usage = contextUsage(
      props.context.data.session.message.list(props.sessionID),
      props.context.data.location.model.list(session.location),
      session.revert?.messageID,
    )
    const spend = props.context.data.session.spend.get(props.sessionID)
    return [
      usage ? formatContextUsage(usage.tokens, usage.percent, usage.limit) : undefined,
      !spend ||
      spend.spent.cost > 0 ||
      spend.costAssessment?.status === "unknown" ||
      spend.costAssessment?.status === "legacy"
        ? formatCost(spend?.spent.cost, spend?.costAssessment)
        : undefined,
    ].filter((item): item is string => Boolean(item))
  })
  const activity = createMemo(() =>
    [subagents(), dimensions().width >= 68 || !subagents() ? shells() : undefined]
      .filter((item): item is string => typeof item === "string")
      .join(" · "),
  )
  const live = createMemo(() => Boolean(activity()))
  const shortcut = (id: string) => props.context.keymap.shortcuts(id)[0]
  const newSession = () => shortcut("session.new") || "/new"
  const layout = createMemo(() => {
    const command = shortcut("command.palette.show")
    return promptFooterLayout({
      width: Math.max(
        0,
        dimensions().width -
          8 -
          stringWidth(`New session ${newSession()}`) -
          2 -
          (live()
            ? stringWidth(
                `${shortcut("session.child.first") ? `${shortcut("session.child.first")} ` : ""}${activity()}`,
              ) + 3
            : 0),
      ),
      usage: status(),
      shortcuts: command ? [`${command} commands`] : [],
    })
  })

  return (
    <Switch>
      <Match when={props.mode === "normal"}>
        <Switch>
          <Match when={live() || status().length > 0}>
            <box flexDirection="row" flexShrink={props.showDetails && layout().usage ? 0 : 1} minWidth={0}>
              <Show when={live()}>
                <box
                  flexShrink={0}
                  onMouseOver={() => setLiveHovered(true)}
                  onMouseOut={() => setLiveHovered(false)}
                  onMouseUp={() => props.context.keymap.dispatch("session.child.first")}
                >
                  <text
                    fg={liveHovered() ? props.context.theme.text.base : props.context.theme.text.muted}
                    wrapMode="none"
                  >
                    <Show when={shortcut("session.child.first")}>
                      {(value) => <span style={{ fg: props.context.theme.text.base }}>{value()} </span>}
                    </Show>
                    {activity()}
                  </text>
                </box>
              </Show>
              <Show when={props.showDetails && layout().usage && status().length > 0}>
                <text fg={props.context.theme.text.muted} wrapMode="none" flexShrink={0}>
                  <Show when={live()}> · </Show>
                  {status().join(" · ")}
                </text>
              </Show>
            </box>
          </Match>
          <Match when={props.showDetails && layout().shortcuts && dimensions().width >= 120}>
            <text fg={props.context.theme.text.base} flexShrink={0}>
              {shortcut("agent.cycle")} <span style={{ fg: props.context.theme.text.muted }}>agents</span>
            </text>
          </Match>
        </Switch>
        <Show when={props.showDetails && dimensions().width >= 44}>
          <text
            id="prompt-new-session"
            wrapMode="none"
            flexShrink={0}
            onMouseUp={() => props.context.keymap.dispatch("session.new")}
          >
            <span style={{ fg: props.context.theme.text.action.primary.base }}>
              <b>New session</b>
            </span>{" "}
            <span style={{ fg: props.context.theme.text.muted }}>{newSession()}</span>
          </text>
        </Show>
        <Show when={props.showDetails && layout().shortcuts}>
          <text fg={props.context.theme.text.base} wrapMode="none" flexShrink={0}>
            {shortcut("command.palette.show")} <span style={{ fg: props.context.theme.text.muted }}>commands</span>
          </text>
        </Show>
      </Match>
      <Match when={props.mode === "shell"}>
        <text fg={props.context.theme.text.base} flexShrink={0}>
          esc{" "}
          <span style={{ fg: props.context.theme.text.muted }}>
            {dimensions().width < 44 ? "shell" : "exit shell mode"}
          </span>
        </text>
      </Match>
    </Switch>
  )
}

export default Plugin.define({
  id: "opencode.prompt.footer",
  setup(context) {
    context.ui.slot({
      append: "prompt.footer",
      render: (props) => (
        <PromptFooter context={context} sessionID={props.sessionID} mode={props.mode} showDetails={props.showDetails} />
      ),
    })
  },
})

function promptFooterLayout(input: { width: number; usage: string[]; shortcuts: string[] }) {
  const usage = input.usage.join(" · ")
  const shortcuts = input.shortcuts.join(" · ")
  const available = Math.max(0, input.width - Math.min(28, Math.floor(input.width / 2)))
  if (usage && shortcuts && stringWidth(`${usage} · ${shortcuts}`) <= available) {
    return { usage: true, shortcuts: true }
  }
  if (usage && stringWidth(usage) <= available) return { usage: true, shortcuts: false }
  if (!usage && shortcuts && stringWidth(shortcuts) <= available) return { usage: false, shortcuts: true }
  return { usage: false, shortcuts: false }
}
