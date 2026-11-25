import { DialogAction, DialogHeading } from "./dialog-message"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { createStore } from "solid-js/store"
import { For } from "solid-js"

export type ExportFormat = "markdown" | "json"

export type DialogExportOptionsProps = {
  defaultThinking: boolean
  defaultToolDetails: boolean
  defaultAssistantMetadata: boolean
  onConfirm?: (options: {
    action: "copy" | "export"
    format: ExportFormat
    thinking: boolean
    tools: boolean
    toolDetails: boolean
    assistantMetadata: boolean
    sanitize: boolean
  }) => void
  onCancel?: () => void
}

const markdownOptions = [
  { key: "thinking", label: "Include thinking" },
  { key: "tools", label: "Include tools" },
  { key: "toolDetails", label: "Include tool details" },
  { key: "assistantMetadata", label: "Include assistant metadata" },
] as const
const jsonOptions = [{ key: "sanitize", label: "Sanitize sensitive data" }] as const
type Option = (typeof markdownOptions | typeof jsonOptions)[number]["key"]
type Active = ExportFormat | Option | "copy" | "export"

export function DialogExportOptions(props: DialogExportOptionsProps) {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const [store, setStore] = createStore({
    format: "markdown" as ExportFormat,
    thinking: props.defaultThinking,
    tools: true,
    toolDetails: props.defaultToolDetails,
    assistantMetadata: props.defaultAssistantMetadata,
    sanitize: false,
    active: "markdown" as Active,
  })

  const confirm = (action: "copy" | "export") =>
    props.onConfirm?.({
      action,
      format: store.format,
      thinking: store.thinking,
      tools: store.tools,
      toolDetails: store.toolDetails,
      assistantMetadata: store.assistantMetadata,
      sanitize: store.sanitize,
    })

  const options = () => (store.format === "markdown" ? markdownOptions : jsonOptions)

  const move = (delta: number) => {
    const order: Active[] = ["markdown", "json", ...options().map((option) => option.key), "copy", "export"]
    setStore("active", order[(order.indexOf(store.active) + delta + order.length) % order.length])
  }

  const choose = (key: Active) => {
    setStore("active", key)
    if (key === "markdown" || key === "json") return setStore("format", key)
    if (key === "copy" || key === "export") return confirm(key)
    setStore(key, (checked) => !checked)
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "tab",
        title: "Next export option",
        group: "Dialog",
        run: () => move(1),
      },
      {
        bind: "shift+tab",
        title: "Previous export option",
        group: "Dialog",
        run: () => move(-1),
      },
      {
        bind: "return",
        title: "Select export option",
        group: "Dialog",
        run: () => choose(store.active),
      },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <DialogHeading title="Export session" onDismiss={dialog.clear} />
      <box flexDirection="row" flexWrap="wrap" gap={1}>
        <text fg={theme.text.base}>Export as:</text>
        <box flexDirection="row" gap={1}>
          <For each={["markdown", "json"] as const}>
            {(format) => (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={
                  store.active === format
                    ? theme.background.formfield.focused
                    : store.format === format
                      ? theme.background.formfield.selected
                      : theme.background.formfield.base
                }
                onMouseUp={() => choose(format)}
              >
                <text
                  fg={
                    store.active === format
                      ? theme.text.formfield.focused
                      : store.format === format
                        ? theme.text.formfield.selected
                        : theme.text.formfield.base
                  }
                >
                  {store.format === format ? "◉" : "○"} {format === "markdown" ? "Markdown" : "JSON"}
                </text>
              </box>
            )}
          </For>
        </box>
      </box>
      <For each={options()}>
        {(option) => {
          const state = () => (store.active === option.key ? "focused" : store[option.key] ? "selected" : "base")
          return (
            <box
              flexDirection="row"
              gap={1}
              backgroundColor={theme.background.formfield[state()]}
              onMouseUp={() => choose(option.key)}
            >
              <text flexShrink={0} fg={theme.text.formfield[state()]}>
                {store[option.key] ? "[x]" : "[ ]"}
              </text>
              <text flexShrink={1} wrapMode="word" fg={theme.text.formfield[state()]}>
                {option.label}
              </text>
            </box>
          )
        }}
      </For>
      <box flexDirection="row" flexWrap="wrap" justifyContent="flex-end" gap={1} paddingBottom={1}>
        <DialogAction label="Copy" focused={store.active === "copy"} onPress={() => choose("copy")} />
        <DialogAction label="Export" primary focused={store.active === "export"} onPress={() => choose("export")} />
      </box>
    </box>
  )
}

DialogExportOptions.show = (
  dialog: DialogContext,
  defaultThinking: boolean,
  defaultToolDetails: boolean,
  defaultAssistantMetadata: boolean,
) => {
  return new Promise<{
    action: "copy" | "export"
    format: ExportFormat
    thinking: boolean
    tools: boolean
    toolDetails: boolean
    assistantMetadata: boolean
    sanitize: boolean
  } | null>((resolve) => {
    dialog.replace(
      () => (
        <DialogExportOptions
          defaultThinking={defaultThinking}
          defaultToolDetails={defaultToolDetails}
          defaultAssistantMetadata={defaultAssistantMetadata}
          onConfirm={(options) => resolve(options)}
          onCancel={() => resolve(null)}
        />
      ),
      () => resolve(null),
    )
  })
}
