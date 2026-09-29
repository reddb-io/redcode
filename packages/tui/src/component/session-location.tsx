import { createEffect, createMemo, createSignal, For, on } from "solid-js"
import { useData } from "../context/data"
import { useTuiPaths } from "../context/runtime"
import { useTheme } from "../context/theme"
import { usePromptMove } from "./prompt/move"
import { useWorkingDirectoryActions } from "../ui/working-directory-actions"
import { locationLines } from "../ui/location-lines"

export function SessionLocation(props: { sessionID: string; id?: string }) {
  const data = useData()
  const paths = useTuiPaths()
  const theme = useTheme()
  const session = createMemo(() => data.session.get(props.sessionID))
  const location = createMemo(() => session()?.location ?? data.location.default())
  const [width, setWidth] = createSignal(32)

  createEffect(
    on(location, (current) => {
      void Promise.allSettled([data.location.syncInfo(current), data.location.vcs.sync(current)])
    }),
  )

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
      checkout: data.location.info(location())?.project.canonical,
      worktree: data.location.info(location())?.project.directory,
      branch: data.location.vcs.info(location())?.branch.current,
      home: paths.home,
      width: width(),
    }),
  )

  return (
    <box
      id={props.id ?? "session.location"}
      width="100%"
      flexShrink={0}
      onSizeChange={function () {
        setWidth(this.width)
      }}
      onMouseOver={actions.onMouseOver}
      onMouseOut={actions.onMouseOut}
      onMouseUp={actions.onMouseUp}
    >
      <For each={lines()}>
        {(line, index) => (
          <text fg={index() === 0 || actions.hovered() ? theme.text.base : theme.text.muted} wrapMode="none">
            {line}
          </text>
        )}
      </For>
    </box>
  )
}
