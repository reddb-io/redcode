import { Plugin } from "@opencode/plugin/tui"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import path from "path"
import { abbreviateHome } from "../../runtime"
import { useTuiPaths } from "../../context/runtime"
import { Locale } from "../../util/locale"
import { useWorkingDirectoryActions } from "../../ui/working-directory-actions"
import { usePromptMove } from "../../component/prompt/move"
import { hasConnectedProvider } from "../../util/connected-provider"

export function SidebarOnboarding(props: { context: Plugin.Context; sessionID: string }) {
  const dimensions = useTerminalDimensions()
  const [onboarding, updateOnboarding] = props.context.storage.store("getting-started", {
    initial: { dismissed: false },
  })
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const integrations = createMemo(() =>
    props.context.data.location.integration.list(session()?.location ?? props.context.location),
  )
  const showOnboarding = createMemo(() => {
    if (dimensions().height < 22) return false
    const list = integrations()
    if (!list) return false
    return !onboarding.dismissed && !hasConnectedProvider(list)
  })

  return (
    <Show when={showOnboarding()}>
      <box
        id="sidebar.footer.getting-started"
        backgroundColor={props.context.theme.background.raised.high}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        flexDirection="row"
        gap={1}
      >
        <text flexShrink={0} fg={props.context.theme.text.base}>
          ⬖
        </text>
        <box flexGrow={1} gap={1}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={props.context.theme.text.base}>
              <b>Getting started</b>
            </text>
            <text
              id="sidebar.footer.getting-started.dismiss"
              fg={props.context.theme.text.muted}
              onMouseUp={() => {
                void updateOnboarding((draft) => {
                  draft.dismissed = true
                }).catch((error) => console.error("Failed to dismiss sidebar onboarding", error))
              }}
            >
              ✕
            </text>
          </box>
          <text fg={props.context.theme.text.muted}>Connect your providers to start working with Redcode.</text>
          <text fg={props.context.theme.text.muted}>
            Choose the providers and models you want to use, including Claude, GPT and Gemini.
          </text>
          <box
            id="sidebar.footer.getting-started.connect"
            flexDirection="row"
            gap={1}
            justifyContent="space-between"
            onMouseUp={() => props.context.keymap.dispatch("provider.connect")}
          >
            <text fg={props.context.theme.text.base}>Connect provider</text>
            <text fg={props.context.theme.text.muted}>/connect</text>
          </box>
        </box>
      </box>
    </Show>
  )
}

export function SidebarFooter(props: { context: Plugin.Context; sessionID: string }) {
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const paths = useTuiPaths()
  const [width, setWidth] = createSignal(32)
  const location = () => session()?.location ?? props.context.location ?? props.context.data.location.default()
  const move = usePromptMove({
    projectID: () => session()?.projectID,
    sessionID: () => props.sessionID,
  })
  const actions = useWorkingDirectoryActions({
    directory: () => location().directory,
    onMove: () => void move.open(),
  })
  const lines = createMemo(() =>
    locationLines({
      directory: location().directory,
      checkout: props.context.data.location.info(location())?.project.canonical,
      worktree: props.context.data.location.info(location())?.project.directory,
      branch: props.context.data.location.vcs.info(location())?.branch.current,
      home: paths.home,
      width: width(),
    }),
  )

  return (
    <box gap={1}>
      <SidebarOnboarding context={props.context} sessionID={props.sessionID} />
      <box
        id="sidebar.footer.location"
        width="100%"
        onSizeChange={function () {
          setWidth(this.width)
        }}
        onMouseOver={actions.onMouseOver}
        onMouseOut={actions.onMouseOut}
        onMouseUp={actions.onMouseUp}
      >
        <For each={lines()}>
          {(line, index) => (
            <text
              fg={index() === 0 || actions.hovered() ? props.context.theme.text.base : props.context.theme.text.muted}
              wrapMode="none"
            >
              {line}
            </text>
          )}
        </For>
      </box>
    </box>
  )
}

/**
 * Project, worktree and branch as three short lines: the primary checkout's directory, then the
 * worktree (relative to the project when nested under it, marked `tmp` in the temporary directory)
 * and the branch. Outside Git only the directory remains. A line too long for `width` loses its
 * middle, so both its root and its name stay readable.
 */
export function locationLines(input: {
  directory: string
  /** The project's primary checkout, as resolved by the server. */
  checkout?: string
  /** The Git worktree containing this Session's directory. */
  worktree?: string
  branch?: string
  home: string
  width: number
}) {
  const nested = input.directory.match(/^(.*?)[\\/]\.red[\\/]worktrees[\\/]([^\\/]+)/)
  const prepared = input.directory.match(/^(.*?)[\\/]\.redcode-worktrees[\\/]([^\\/]+)[\\/]([^\\/]+)/)
  // A temporary worktree (`--tmp`): `<tmp>/redcode-worktrees/<repository>-<hash>/<name>`.
  const temporary =
    nested || prepared ? undefined : input.directory.match(/^(.*?[\\/]redcode-worktrees[\\/][^\\/]+[\\/][^\\/]+)/)
  const project = input.checkout ?? (nested ? nested[1] : prepared ? path.join(prepared[1], prepared[2]) : input.directory)
  const worktree =
    input.worktree && input.checkout && input.worktree !== input.checkout
      ? contains(input.checkout, input.worktree)
        ? path.relative(input.checkout, input.worktree).replaceAll("\\", "/")
        : abbreviateHome(input.worktree, input.home)
      : nested
        ? [".red", "worktrees", nested[2]].join("/")
        : prepared
          ? abbreviateHome(path.join(prepared[1], ".redcode-worktrees", prepared[2], prepared[3]), input.home)
          : temporary
            ? abbreviateHome(temporary[1], input.home)
            : undefined
  // truncateMiddle needs room for a character on each side of its ellipsis.
  const fit = (prefix: string, text: string) =>
    prefix + Locale.truncateMiddle(text, Math.max(3, input.width - prefix.length))
  return [
    fit("", abbreviateHome(project, input.home)),
    ...(worktree || input.branch ? [fit(temporary ? "⎇ tmp " : "⎇ ", worktree ?? "primary checkout")] : []),
    ...(input.branch ? [fit("⑂ ", input.branch)] : []),
  ]
}

function contains(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

export default Plugin.define({
  id: "opencode.sidebar.footer",
  setup(context) {
    // Append keeps the path open to additive plugin claims; an external
    // replace still takes the boundary over.
    context.ui.slot({
      append: "sidebar.footer",
      render: (props) => <SidebarFooter context={context} sessionID={props.sessionID} />,
    })
  },
})
