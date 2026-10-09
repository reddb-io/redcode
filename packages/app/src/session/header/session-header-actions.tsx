import { createMemo, For, Show } from "solid-js"
import { quietControl } from "@reddb-io/design-system/contracts/quiet-control"
import { toggleButton } from "@reddb-io/design-system/contracts/toggle-button"
import { Icon } from "@opencode/ui/icon"
import type { IconName } from "@opencode/ui/icons/catalog"
import { IconButton } from "@opencode/ui/icon-button"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useSessionLayout } from "@/session/session-layout"
import { useLayout } from "@/shell/state/layout"
import { useExtensionAttachment } from "@/runtime/extension/attachment"
import type { Region } from "@/runtime/extension/panels"

type PanelToggle = {
  id: string
  label: string
  icon: IconName
  keybind?: string
  pressed: boolean
  controls?: string
  run(): void
}

/**
 * The session header's panel toggles, as Claude's titlebar has them: Terminal, Changes, Browser and the file tree,
 * then the side column itself. Each shows whether its panel is on screen and runs the command that toggles it.
 */
export function SessionPanelToggles(props: { region: Region; dock?: string }) {
  const command = useCommand()
  const language = useLanguage()
  const layout = useLayout()
  const attachment = useExtensionAttachment()
  const { view } = useSessionLayout()

  const available = (id: string) => command.options.some((option) => option.id === id && !option.disabled)
  const sideOpen = () => view().side.opened()

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
    view().side.toggle()
  }

  const toggles = createMemo(() => {
    const list: (PanelToggle | false)[] = [
      available("terminal.toggle") && {
        id: "terminal",
        label: language.t("workbench.toggle.terminal"),
        icon: "terminal",
        keybind: "terminal.toggle",
        pressed: view().dock.opened(),
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

  return (
    <div role="toolbar" aria-label={language.t("workbench.toggle.label")} class="flex items-center gap-0.5">
      <For each={toggles()}>{(toggle) => <PanelToggleButton toggle={toggle} />}</For>
      <div class="mx-1 h-4 w-px bg-muted" aria-hidden="true" />
      <PanelToggleButton
        toggle={{
          id: "side",
          label: language.t("command.review.toggle"),
          icon: "sidebar-right",
          keybind: "review.toggle",
          pressed: sideOpen(),
          controls: "review-panel",
          run: () => view().side.toggle(),
        }}
      />
    </div>
  )
}

function PanelToggleButton(props: { toggle: PanelToggle }) {
  const command = useCommand()
  const keys = createMemo(() => (props.toggle.keybind ? command.keybindParts(props.toggle.keybind) : []))

  return (
    <Tooltip
      class="shrink-0"
      placement="bottom"
      value={
        <>
          {props.toggle.label}
          <Show when={keys().length > 0}>
            <Keybind keys={keys()} variant="neutral" />
          </Show>
        </>
      }
    >
      <button
        type="button"
        data-action={`session-toggle-${props.toggle.id}`}
        aria-label={props.toggle.label}
        aria-pressed={props.toggle.pressed}
        aria-controls={props.toggle.controls}
        class={quietControl({
          class: toggleButton({
            pressed: props.toggle.pressed,
            class: "size-7 inline-flex items-center justify-center rounded-md border-b-2 border-b-transparent",
          }),
        })}
        onClick={() => props.toggle.run()}
      >
        <Icon name={props.toggle.icon} />
      </button>
    </Tooltip>
  )
}

export type SessionHeaderActionsState = {
  reviewLabel: string
  reviewKeybind: string[]
  reviewVisible: boolean
  reviewOpened: boolean
  onReviewToggle: () => void
}

export function SessionHeaderActions(props: { state: SessionHeaderActionsState }) {
  return (
    <div class="flex items-center gap-2">
      <Show when={props.state.reviewVisible}>
        <Tooltip
          class="shrink-0"
          placement="bottom"
          value={
            <>
              {props.state.reviewLabel}
              <Show when={props.state.reviewKeybind.length > 0}>
                <Keybind keys={props.state.reviewKeybind} variant="neutral" />
              </Show>
            </>
          }
        >
          <IconButton
            type="button"
            variant="ghost-muted"
            size="large"
            class="shrink-0"
            style={{
              // This fixed control sits above moving panel contents.
              "--v2-overlay-simple-overlay-hover": "var(--v2-background-bg-layer-01)",
              "--v2-overlay-simple-overlay-pressed": "var(--v2-background-bg-layer-02)",
            }}
            state={props.state.reviewOpened ? "pressed" : undefined}
            onClick={props.state.onReviewToggle}
            aria-label={props.state.reviewLabel}
            aria-expanded={props.state.reviewOpened}
            aria-controls="review-panel"
            icon={<Icon name="sidebar-right" />}
          />
        </Tooltip>
      </Show>
    </div>
  )
}
