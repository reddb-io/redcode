import { createMemo, For, Show, type JSX } from "solid-js"
import { emptyState } from "@opencode/ui/contracts/empty-state"
import { eyebrow } from "@opencode/ui/contracts/eyebrow"
import { kbd, kbdChord } from "@opencode/ui/contracts/kbd"
import { listRow } from "@opencode/ui/contracts/list-row"
import { quietControl } from "@opencode/ui/contracts/quiet-control"
import { Icon } from "@opencode/ui/icon"
import type { IconName } from "@opencode/ui/icons/catalog"
import { MenuItem, Panel } from "@opencode/gui-extensions/sdk"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useExtensionHost } from "./host"
import { useExtensionAttachment } from "./attachment"
import type { Region } from "./panels"

export type LauncherItem = {
  readonly id: string
  /** The panel key the item opens, when it opens one tab the column may already hold. */
  readonly key?: string
  readonly title: string
  readonly description?: string
  readonly icon?: IconName
  /** The command whose shortcut the row shows. */
  readonly keybind?: string
  readonly order: number
  run(): void
}

/**
 * What a workbench group can open: the host's panels (the dock, Changes, Context) and session commands that open a
 * panel, merged with the "+" items extensions contribute. Items whose panel or command is missing are left out.
 */
export function createLauncherItems(input: { region: Region; dock: () => string | undefined }) {
  const host = useExtensionHost()
  const command = useCommand()
  const language = useLanguage()
  const attachment = useExtensionAttachment()

  const enabled = (id: string) => command.options.some((option) => option.id === id && !option.disabled)
  const panel = (extension: string) => host.items(Panel).some((item) => item.extension === extension)

  return createMemo((): LauncherItem[] => {
    const dock = input.dock()

    const builtin: (LauncherItem | false)[] = [
      !!dock && {
        id: "terminal",
        key: dock,
        title: language.t("workbench.item.terminal"),
        description: language.t("workbench.item.terminal.description"),
        icon: "terminal",
        keybind: "terminal.toggle",
        order: 15,
        run: () => attachment.panels.open(dock),
      },
      !!input.region.entry("review:changes") && {
        id: "changes",
        key: "review:changes",
        title: language.t("workbench.item.changes"),
        description: language.t("workbench.item.changes.description"),
        icon: "review",
        order: 30,
        run: () => attachment.panels.open("review:changes"),
      },
      panel("context") && {
        id: "context",
        key: "context:main",
        title: language.t("workbench.item.context"),
        description: language.t("workbench.item.context.description"),
        icon: "status",
        order: 40,
        run: () => attachment.panels.open("context:main"),
      },
      enabled("btw.ask") && {
        id: "btw",
        title: language.t("workbench.item.btw"),
        description: language.t("workbench.item.btw.description"),
        icon: "bubble-5",
        keybind: "btw.ask",
        order: 50,
        run: () => void command.trigger("btw.ask", "palette"),
      },
      enabled("design.open") && {
        id: "design",
        title: language.t("workbench.item.design"),
        description: language.t("workbench.item.design.description"),
        icon: "window-cursor",
        keybind: "design.open",
        order: 60,
        run: () => void command.trigger("design.open", "palette"),
      },
    ]

    const contributed = host.list(MenuItem).flatMap((item): LauncherItem[] =>
      item.menu === "session.panel"
        ? [
            {
              id: `menu:${item.id}`,
              title: item.title,
              icon: item.icon,
              keybind: item.keybind,
              order: item.order ?? 0,
              run: () => item.run(),
            },
          ]
        : [],
    )

    return [...builtin.filter((item) => item !== false), ...contributed].toSorted((a, b) => a.order - b.order)
  })
}

/** The page a workbench group shows while it has no tabs, or after its "+": every panel it can open. */
export function Launcher(props: { items: readonly LauncherItem[]; onRun: (item: LauncherItem) => void }): JSX.Element {
  const language = useLanguage()
  const empty = emptyState({ size: "sm", bordered: false })

  return (
    <div data-component="workbench-launcher" class="size-full overflow-y-auto bg-elevation-base-surface">
      <div class={empty.root({ class: "min-h-full justify-start rounded-none py-6" })}>
        <span class={empty.media()}>
          <Icon name="grid-plus" size="large" />
        </span>
        <div class="flex flex-col items-center gap-1">
          <h2 class={empty.title()}>{language.t("workbench.launcher.title")}</h2>
          <p class={empty.description()}>{language.t("workbench.launcher.description")}</p>
        </div>
        <div class="w-full max-w-sm flex flex-col gap-2 text-start">
          <span class={eyebrow({ class: "px-2" })}>{language.t("workbench.launcher.panels")}</span>
          <ul class="flex flex-col rounded-lg border border-muted overflow-hidden">
            <For each={props.items}>
              {(item) => <LauncherRow item={item} onRun={props.onRun} />}
            </For>
          </ul>
        </div>
      </div>
    </div>
  )
}

function LauncherRow(props: { item: LauncherItem; onRun: (item: LauncherItem) => void }): JSX.Element {
  const command = useCommand()
  const row = listRow({ size: "sm", interactive: true })
  const keys = createMemo(() => (props.item.keybind ? command.keybindParts(props.item.keybind) : []))

  return (
    <li class="last:[&>button]:border-b-0">
      <button
        type="button"
        data-action={`workbench-launch-${props.item.id}`}
        class={quietControl({ ink: "foreground", focus: "inset", class: row.root() })}
        onClick={() => props.onRun(props.item)}
      >
        <span class={row.leading({ class: "size-5 justify-center text-ink-muted" })}>
          <Show when={props.item.icon}>{(icon) => <Icon name={icon()} />}</Show>
        </span>
        <span class={row.text()}>
          <span class={row.title()}>{props.item.title}</span>
          <Show when={props.item.description}>
            {(description) => <span class={row.description()}>{description()}</span>}
          </Show>
        </span>
        <Show when={keys().length > 0}>
          <span class={row.trailing()}>
            <kbd class={kbdChord().root()}>
              <For each={keys()}>{(key) => <kbd class={kbd({ size: "sm" })}>{key}</kbd>}</For>
            </kbd>
          </span>
        </Show>
      </button>
    </li>
  )
}
