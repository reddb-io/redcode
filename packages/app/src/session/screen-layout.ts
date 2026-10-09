import { createMemo, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useLayout } from "@/shell/state/layout"
import { useSettings } from "@/settings/model"
import { createSizing } from "./helpers"
import type { SessionModel } from "./model"
import { clampSessionPanelWidth, sessionPanelWidthMax } from "./session-panel-width"

/**
 * wide asks for the wider session minimum; sidebar is whether any extension fills the side panel sidebar; expanded is
 * the workbench's full-width mode, where the side column takes the whole session area.
 */
export function createSessionScreenLayout(
  session: SessionModel,
  input: { wide: Accessor<boolean>; sidebar: Accessor<boolean>; expanded: Accessor<boolean> },
) {
  const layout = useLayout()
  const settings = useSettings()
  const size = createSizing()
  const view = session.layout.view
  const tabsOpen = createMemo(() => session.isDesktop() && view().side.opened() && !!session.identity.params.id)
  const dockOpen = createMemo(() => view().dock.opened())
  const dockSide = createMemo(() => session.isDesktop() && settings.general.terminalPlacement() === "side")
  const dockBottom = createMemo(() => session.isDesktop() && settings.general.terminalPlacement() === "bottom")
  const dockSideOpen = createMemo(() => dockOpen() && dockSide())

  const fileTreeOpen = createMemo(
    () => session.isDesktop() && input.sidebar() && settings.visibility.fileTree() && layout.fileTree.opened(),
  )

  const resizable = createMemo(() => tabsOpen() || dockSideOpen())
  // Full width needs a column to fill the area; with nothing open the conversation stays.
  const expanded = createMemo(() => input.expanded() && resizable())
  const besideOpen = createMemo(() => resizable() || fileTreeOpen())
  const [rowSize, setRowSize] = createStore<{ width?: number; height?: number }>({})
  let row: HTMLDivElement | undefined
  createResizeObserver(
    () => row,
    ({ width, height }) => setRowSize({ width, height }),
  )

  const available = createMemo<number | undefined>(() => {
    const width = rowSize.width

    if (width === undefined) return undefined

    return width - 8
  })

  const splitSide = createMemo(() => tabsOpen() && input.wide())

  const resizedWidth = createMemo(() =>
    clampSessionPanelWidth({
      width: view().session.width(),
      available: available(),
      split: splitSide(),
    }),
  )

  const panelWidth = createMemo(() => {
    if (!besideOpen()) return "100%"

    if (expanded()) return "0px"

    if (resizable()) return `${resizedWidth()}px`

    return `calc(100% - ${layout.fileTree.width()}px)`
  })

  const panelMax = createMemo(() => {
    const width = available()

    if (width === undefined) return 1000

    return sessionPanelWidthMax({ available: width, split: splitSide() })
  })

  const panelLayout = createMemo(() => ({
    visible: tabsOpen() || dockSideOpen() || fileTreeOpen(),
  }))

  const sideContentWidth = createMemo<string>((previous) => {
    const width = available()

    // The conversation gives up its width and the gap beside it.
    if (expanded() && width !== undefined) return `${width + 8}px`

    if (resizable() && width !== undefined) return `${Math.max(0, width - resizedWidth())}px`

    if (fileTreeOpen()) return `${layout.fileTree.width()}px`

    return previous
  }, "100%")

  return {
    centered: createMemo(() => session.isDesktop()),
    expanded,
    files: { open: fileTreeOpen },
    panel: {
      max: panelMax,
      ref: (element: HTMLDivElement) => {
        row = element
      },
      resizable: createMemo(() => resizable() && !expanded()),
      resizedWidth,
      width: panelWidth,
    },
    side: {
      contentWidth: sideContentWidth,
      layout: panelLayout,
      /** The workbench column: side tabs, or the dock while it sits beside the timeline. */
      column: { open: createMemo(() => tabsOpen() || dockSideOpen()) },
      tabs: { open: tabsOpen },
    },
    size,
    dock: {
      bottom: dockBottom,
      open: dockOpen,
      side: dockSide,
    },
  }
}

export type SessionScreenLayout = ReturnType<typeof createSessionScreenLayout>
