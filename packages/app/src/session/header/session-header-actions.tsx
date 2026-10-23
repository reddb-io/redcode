import { createMemo } from "solid-js"
import type { IconName } from "@opencode/ui/icons/catalog"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useSessionLayout } from "@/session/session-layout"
import { useLayout } from "@/shell/state/layout"
import { useExtensionAttachment } from "@/runtime/extension/attachment"
import type { Region } from "@/runtime/extension/panels"
import { sharedSource } from "@/runtime/react/source"
import { ReactView } from "@/runtime/react/view"
import { SessionPanelTogglesView, SessionHeaderActionsView } from "./session-header-actions.react"

type PanelToggle = {
  id: string
  label: string
  icon: IconName
  keybind?: string
  pressed: boolean
  controls?: string
  run(): void
}

/** Preserve command and panel ownership while native DS buttons render the toolbar. */
export function createSessionPanelServices(props: { region: Region; dock?: string }) {
  const command = useCommand()
  const language = useLanguage()
  const layout = useLayout()
  const attachment = useExtensionAttachment()
  const sessionLayout = useSessionLayout()

  const available = (id: string) => command.options.some((option) => option.id === id && !option.disabled)
  const sideOpen = () => sessionLayout.view().side.opened()

  const browser = createMemo(() =>
    props.region.entries().flatMap((entry) => (entry.extension === "browser" && !entry.tab.hidden ? [entry.key] : [])),
  )

  const browserShown = createMemo(() => sideOpen() && browser().some((key) => props.region.showing(key)))

  // Hiding a browser keeps its pages: another tab of its group takes the place, or the column closes.
  const hideBrowser = () => {
    const key = browser().find((item) => props.region.showing(item))

    if (!key) return
    const other = props.region.groups[props.region.groupOf(key)].keys().find((item) => item !== key)

    if (other) return props.region.select(other)
    sessionLayout.view().side.toggle()
  }

  const toggles = createMemo(() => {
    const list: (PanelToggle | false)[] = [
      available("terminal.toggle") && {
        id: "terminal",
        label: language.t("workbench.toggle.terminal"),
        icon: "terminal",
        keybind: "terminal.toggle",
        pressed: sessionLayout.view().dock.opened(),
        controls: props.dock ? "terminal-panel" : undefined,
        run: () => void command.trigger("terminal.toggle", "palette"),
      },
      !!props.region.entry("review:changes") && {
        id: "changes",
        label: language.t("workbench.toggle.changes"),
        icon: "review",
        pressed: attachment.panels.state("review:changes") === "visible",
        controls: "review-panel",
        run: () => attachment.panels.toggle("review:changes"),
      },
      available("browser.open") && {
        id: "browser",
        label: language.t("workbench.toggle.browser"),
        icon: "globe",
        keybind: "browser.open",
        pressed: browserShown(),
        controls: "review-panel",
        run: () => {
          if (browserShown()) return hideBrowser()
          const last = browser().at(-1)

          if (last) return attachment.panels.open(last)
          void command.trigger("browser.open", "palette")
        },
      },
      command.options.some((option) => option.id === "fileTree.toggle") && {
        id: "files",
        label: language.t("workbench.toggle.files"),
        icon: "file-tree",
        keybind: "fileTree.toggle",
        pressed: layout.fileTree.opened(),
        controls: "file-tree-panel",
        run: () => void command.trigger("fileTree.toggle", "palette"),
      },
    ]

    return list.filter((toggle) => toggle !== false)
  })

  return {
    snapshot: sharedSource(() => ({
      label: language.t("workbench.toggle.label"),
      toggles: toggles().map((toggle) => ({
        ...toggle,
        keys: toggle.keybind ? command.keybindParts(toggle.keybind) : [],
      })),
      side: {
        id: "side",
        label: language.t("command.review.toggle"),
        icon: "sidebar-right" as const,
        keys: command.keybindParts("review.toggle"),
        pressed: sideOpen(),
        controls: "review-panel",
        run: () => sessionLayout.view().side.toggle(),
      },
    })),
  }
}

export function SessionPanelToggles(props: Parameters<typeof createSessionPanelServices>[0]) {
  const services = createSessionPanelServices(props)
  return <ReactView component={SessionPanelTogglesView} props={{ services }} />
}

export type SessionHeaderActionsState = {
  reviewLabel: string
  reviewKeybind: string[]
  reviewVisible: boolean
  reviewOpened: boolean
  onReviewToggle: () => void
}

export function createSessionHeaderActionsServices(props: { state: SessionHeaderActionsState }) {
  return {
    snapshot: sharedSource(() => ({
      reviewLabel: props.state.reviewLabel,
      reviewKeybind: props.state.reviewKeybind,
      reviewVisible: props.state.reviewVisible,
      reviewOpened: props.state.reviewOpened,
    })),
    toggle: () => props.state.onReviewToggle(),
  }
}

export function SessionHeaderActions(props: Parameters<typeof createSessionHeaderActionsServices>[0]) {
  const services = createSessionHeaderActionsServices(props)
  return <ReactView component={SessionHeaderActionsView} props={{ services }} />
}
