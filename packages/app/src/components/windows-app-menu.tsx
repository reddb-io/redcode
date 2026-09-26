import { Show, type JSX } from "solid-js"
import { DropdownMenu } from "@reddb-io/redcode-ui/dropdown-menu"
import { Icon } from "@reddb-io/redcode-ui/icon"
import { IconButton } from "@reddb-io/redcode-ui/icon-button"
import { IconButtonV2 } from "@reddb-io/redcode-ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@reddb-io/redcode-ui/v2/icon"

import { useCommand } from "@/context/command"
import { DESKTOP_MENU, desktopMenuVisible, type DesktopMenuAction, type DesktopMenuEntry } from "@/desktop-menu"
import { usePlatform } from "@/context/platform"

export function WindowsAppMenu(props: {
  command: ReturnType<typeof useCommand>
  platform: ReturnType<typeof usePlatform>
  variant?: "legacy" | "v2"
}) {
  let lastFocused: HTMLElement | undefined

  const rememberFocus = () => {
    const active = document.activeElement
    lastFocused = active instanceof HTMLElement ? active : undefined
  }
  const commandDisabled = (id: string) => {
    const option = props.command.options.find((option) => option.id === id)
    if (!option) return true
    return option.disabled ?? false
  }
  const runCommand = (id: string) => {
    if (commandDisabled(id)) return
    props.command.trigger(id)
  }
  const runAction = (action: DesktopMenuAction) => {
    if (action.startsWith("edit.") && lastFocused?.isConnected) lastFocused.focus({ preventScroll: true })
    void props.platform.runDesktopMenuAction?.(action)
  }
  const runEntry = (entry: DesktopMenuEntry) => {
    if (entry.type === "separator") return
    if (entry.command) {
      runCommand(entry.command)
      return
    }
    if (entry.action) {
      runAction(entry.action)
      return
    }
    if (entry.href) props.platform.openExternal(entry.href)
  }

  return (
    <DropdownMenu gutter={4} modal={false} placement="bottom-start">
      {props.variant === "v2" ? (
        <div
          data-component="desktop-icon-button"
          class="flex h-7 w-9 shrink-0 items-center justify-center rounded-[6px] px-1"
        >
          <DropdownMenu.Trigger
            as={IconButtonV2}
            variant="ghost-muted"
            size="large"
            icon={<IconV2 name="menu" />}
            aria-label={"Redcode menu"}
            onPointerDown={rememberFocus}
            onKeyDown={rememberFocus}
          />
        </div>
      ) : (
        <DropdownMenu.Trigger
          as={IconButton}
          icon="menu"
          variant="ghost"
          class="titlebar-icon rounded-md shrink-0"
          aria-label={"Redcode menu"}
          onPointerDown={rememberFocus}
          onKeyDown={rememberFocus}
        />
      )}
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="desktop-app-menu">
          <DropdownMenu.Group>
            <DropdownMenu.GroupLabel class="desktop-app-menu-heading">Redcode</DropdownMenu.GroupLabel>
            {DESKTOP_MENU.filter((menu) => desktopMenuVisible(menu, "windows")).map((menu) => (
              <DesktopMenuSubmenu label={menuLabels[menu.labelKey] ?? menu.labelKey}>
                {menu.items
                  ?.filter((entry) => desktopMenuVisible(entry, "windows"))
                  .map((entry) =>
                    entry.type === "separator" ? (
                      <DropdownMenu.Separator />
                    ) : (
                      <DesktopMenuItem
                        label={entry.labelKey ? (menuLabels[entry.labelKey] ?? entry.labelKey) : ""}
                        keybind={entry.command ? props.command.keybind(entry.command) : entry.accelerator?.windows}
                        disabled={entry.command ? commandDisabled(entry.command) : false}
                        onSelect={() => runEntry(entry)}
                      />
                    ),
                  )}
              </DesktopMenuSubmenu>
            ))}
          </DropdownMenu.Group>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}

function DesktopMenuSubmenu(props: { label: string; children: JSX.Element }) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger>
        <span data-slot="dropdown-menu-item-label">{props.label}</span>
        <span data-slot="desktop-app-menu-chevron">
          <Icon name="chevron-right" size="small" />
        </span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent class="desktop-app-menu">{props.children}</DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  )
}

function DesktopMenuItem(props: { label: string; keybind?: string; disabled?: boolean; onSelect: () => void }) {
  return (
    <DropdownMenu.Item disabled={props.disabled} onSelect={props.onSelect}>
      <DropdownMenu.ItemLabel>{props.label}</DropdownMenu.ItemLabel>
      <Show when={props.keybind}>
        <span data-slot="desktop-app-menu-keybind">{props.keybind}</span>
      </Show>
    </DropdownMenu.Item>
  )
}

const menuLabels: Record<string, string> = {
  "desktop.menu.app": "Redcode",
  "desktop.menu.file": "File",
  "desktop.menu.edit": "Edit",
  "desktop.menu.view": "View",
  "desktop.menu.go": "Go",
  "desktop.menu.window": "Window",
  "desktop.menu.help": "Help",
  "desktop.menu.checkForUpdates": "Check for Updates...",
  "desktop.menu.settings": "Settings",
  "desktop.menu.reloadWebview": "Reload Webview",
  "desktop.menu.restart": "Restart",
  "desktop.menu.exportLogs": "Export Logs...",
  "desktop.menu.newSession": "New Session",
  "desktop.menu.openProject": "Open Project...",
  "desktop.menu.newWindow": "New Window",
  "desktop.menu.closeWindow": "Close Window",
  "desktop.menu.undo": "Undo",
  "desktop.menu.redo": "Redo",
  "desktop.menu.cut": "Cut",
  "desktop.menu.copy": "Copy",
  "desktop.menu.paste": "Paste",
  "desktop.menu.delete": "Delete",
  "desktop.menu.selectAll": "Select All",
  "desktop.menu.toggleSidebar": "Toggle Sidebar",
  "desktop.menu.toggleTerminal": "Toggle Terminal",
  "desktop.menu.toggleFileTree": "Toggle File Tree",
  "desktop.menu.reload": "Reload",
  "desktop.menu.toggleDeveloperTools": "Toggle Developer Tools",
  "desktop.menu.actualSize": "Actual Size",
  "desktop.menu.zoomIn": "Zoom In",
  "desktop.menu.zoomOut": "Zoom Out",
  "desktop.menu.toggleFullScreen": "Toggle Full Screen",
  "desktop.menu.back": "Back",
  "desktop.menu.forward": "Forward",
  "desktop.menu.previousSession": "Previous Session",
  "desktop.menu.nextSession": "Next Session",
  "desktop.menu.previousProject": "Previous Project",
  "desktop.menu.nextProject": "Next Project",
  "desktop.menu.minimize": "Minimize",
  "desktop.menu.maximize": "Maximize",
  "desktop.menu.documentation": "Redcode Documentation",
  "desktop.menu.supportForum": "Support Forum",
  "desktop.menu.shareFeedback": "Share Feedback",
  "desktop.menu.reportBug": "Report a Bug",
}
