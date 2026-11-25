import { InputRenderable } from "@opentui/core"
import { Slug } from "@opencode/core/util/slug"
import { createSignal, onMount } from "solid-js"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "../ui/dialog"
import { ActionButton } from "../ui/action-button"
import { DialogHeading } from "../ui/dialog-message"
import { useConfig } from "../config"

export function DialogWorktreeName(props: { onConfirm: (name: string) => void }) {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const shortcuts = Keymap.useShortcuts()
  const config = useConfig().data
  const [inputTarget, setInputTarget] = createSignal<InputRenderable>()
  let input: InputRenderable

  function generate() {
    input.value = Slug.create()
    input.gotoLineEnd()
  }

  function confirm() {
    props.onConfirm(slugify(input.value) || Slug.create())
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    target: inputTarget,
    enabled: inputTarget() !== undefined,
    priority: 1,
    commands: [
      {
        id: "dialog.worktree.generate",
        title: "Generate worktree name",
        group: "Dialog",
        run: generate,
      },
    ],
  }))

  onMount(() => {
    dialog.setSize("medium")
    setTimeout(() => {
      if (!input || input.isDestroyed) return
      input.focus()
    }, 1)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <DialogHeading title="Name worktree" onDismiss={dialog.clear} />
      <input
        cursorStyle={config.cursor}
        ref={(value: InputRenderable) => {
          input = value
          setInputTarget(value)
        }}
        onSubmit={confirm}
        placeholder="Worktree name"
        placeholderColor={theme.text.muted}
        textColor={theme.text.formfield.base}
        backgroundColor={theme.background.formfield.base}
        focusedBackgroundColor={theme.background.formfield.focused}
        focusedTextColor={theme.text.formfield.focused}
        cursorColor={theme.text.formfield.focused}
      />
      <box paddingBottom={1} flexDirection="row" flexWrap="wrap" columnGap={1}>
        <ActionButton label="enter submit" primary onPress={confirm} />
        <ActionButton
          label={`${shortcuts.get("dialog.worktree.generate") ?? ""} generate one`.trimStart()}
          onPress={generate}
        />
      </box>
    </box>
  )
}

DialogWorktreeName.show = (dialog: DialogContext) =>
  new Promise<string | null>((resolve) => {
    dialog.replace(
      () => <DialogWorktreeName onConfirm={resolve} />,
      () => resolve(null),
    )
  })

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}
