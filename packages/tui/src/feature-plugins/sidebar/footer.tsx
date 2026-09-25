import type { TuiPlugin, TuiPluginApi } from "@reddb-io/redcode-plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, createResource, For, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import path from "path"
import { abbreviateHome } from "../../runtime"
import { useTuiPaths } from "../../context/runtime"
import { Locale } from "../../util/locale"
import { effectiveSidebarWidth, SIDEBAR_WIDTH_MAX } from "../../routes/session/sidebar-width"

const id = "internal:sidebar-footer"

export function SidebarFooter(props: { api: TuiPluginApi; sessionID: string }) {
  const paths = useTuiPaths()
  const dimensions = useTerminalDimensions()
  const theme = () => props.api.theme.current
  const has = createMemo(() =>
    props.api.state.provider.some(
      (item) => item.id !== "opencode" || Object.values(item.models).some((model) => model.cost?.input !== 0),
    ),
  )
  const done = createMemo(() => props.api.kv.get("dismissed_getting_started", false))
  const show = createMemo(() => !has() && !done())
  const directory = createMemo(
    () => props.api.state.session.get(props.sessionID)?.directory || props.api.state.path.directory || paths.cwd,
  )
  // The synced VCS state describes the TUI's own directory; a session moved into a worktree asks for its own.
  const [moved] = createResource(
    () => (directory() === props.api.state.path.directory ? undefined : directory()),
    (dir) =>
      props.api.client?.vcs
        .get({ directory: dir })
        .then((result) => result.data?.branch)
        .catch(() => undefined),
  )
  const lines = createMemo(() =>
    locationLines({
      directory: directory(),
      checkout: props.api.state.path.worktree,
      branch: directory() === props.api.state.path.directory ? props.api.state.vcs?.branch : moved(),
      home: paths.home,
      width:
        Math.min(
          effectiveSidebarWidth(props.api.kv.get("sidebar_width"), dimensions().width),
          SIDEBAR_WIDTH_MAX,
        ) - 4,
    }),
  )

  return (
    <box gap={1}>
      <Show when={show()}>
        <box
          backgroundColor={theme().backgroundElement}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          flexDirection="row"
          gap={1}
        >
          <text flexShrink={0} fg={theme().text}>
            ⬖
          </text>
          <box flexGrow={1} gap={1}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme().text}>
                <b>Getting started</b>
              </text>
              <text fg={theme().textMuted} onMouseDown={() => props.api.kv.set("dismissed_getting_started", true)}>
                ✕
              </text>
            </box>
            <text fg={theme().textMuted}>Free models are included so you can start immediately.</text>
            <text fg={theme().textMuted}>
              Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc
            </text>
            <box flexDirection="row" gap={1} justifyContent="space-between">
              <text fg={theme().text}>Connect provider</text>
              <text fg={theme().textMuted}>/connect</text>
            </box>
          </box>
        </box>
      </Show>
      <box>
        <For each={lines()}>
          {(line, index) => (
            <text fg={index() === 0 ? theme().text : theme().textMuted} wrapMode="none">
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
  /** The TUI's own checkout, taken as the primary one for directories inside it. */
  checkout?: string
  branch?: string
  home: string
  width: number
}) {
  const nested = input.directory.match(/^(.*?)[\\/]\.red[\\/]worktrees[\\/]([^\\/]+)/)
  const prepared = input.directory.match(/^(.*?)[\\/]\.redcode-worktrees[\\/]([^\\/]+)[\\/]([^\\/]+)/)
  // A temporary worktree (`--tmp`): `<tmp>/redcode-worktrees/<repository>-<hash>/<name>`.
  const temporary =
    nested || prepared ? undefined : input.directory.match(/^(.*?[\\/]redcode-worktrees[\\/][^\\/]+[\\/][^\\/]+)/)
  const project = nested
    ? nested[1]
    : prepared
      ? path.join(prepared[1], prepared[2])
      : input.checkout && input.checkout !== "/" && (temporary || contains(input.checkout, input.directory))
        ? input.checkout
        : input.directory
  const worktree = nested
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

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_footer(_ctx, props) {
        return <SidebarFooter api={api} sessionID={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
