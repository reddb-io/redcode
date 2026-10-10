import { useCommand, type CommandOption } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { DialogSelectModel } from "@/providers/models/select-dialog"
import { useLocal, type ModelSelection } from "@/providers/models/selection"
import { useModels } from "@/providers/models/models"
import { ModelPresentation } from "@opencode/schema/model-presentation"
import { showToast } from "@/shell/notifications/toast"
import { useDialog } from "@opencode/ui/context/dialog"
import { getCursorPosition, setCursorPosition } from "./editor/dom"
import { useSessionLayout } from "@/session/session-layout"
import { createSessionOwnership } from "@/session/session-ownership"
import { useWorkspaceLocation } from "@/workspaces/location"

const withCategory = (category: string) => {
  return (option: Omit<CommandOption, "category">): CommandOption => ({
    ...option,
    category,
  })
}

export const useComposerCommands = (input: { model?: ModelSelection } = {}) => {
  const command = useCommand()
  const dialog = useDialog()
  const language = useLanguage()
  const local = useLocal()
  const workspace = useWorkspaceLocation()
  const { sessionKey } = useSessionLayout()
  const sessionOwnership = createSessionOwnership(sessionKey)
  const model = input.model ?? local.model
  const models = useModels()
  const modelCommand = withCategory(language.t("command.category.model"))
  const agentCommand = withCategory(language.t("command.category.agent"))
  const providerCommand = withCategory(language.t("command.category.provider"))

  // Mirrors the TUI's `/connect`, which the Console's setup steps tell people to run.
  const connectProvider = async () => {
    const { DialogConnectProvider } = await import("@/providers/connect/dialog")
    void dialog.show(() => (
      <DialogConnectProvider
        directory={workspace().directory}
        onPickModel={(provider) => dialog.show(() => <DialogSelectModel provider={provider} model={model} />)}
      />
    ))
  }

  // Steps through recent or favorite models like the TUI's model.cycle_* commands, skipping unavailable ones.
  const cycleModel = (list: ReadonlyArray<{ providerID: string; modelID: string }>, direction: 1 | -1) => {
    const current = model.current()
    const available = list.filter((item) =>
      model.list().some((entry) => entry.provider.id === item.providerID && entry.id === item.modelID),
    )

    return ModelPresentation.cycleModel(
      available,
      current && { providerID: current.provider.id, modelID: current.id },
      direction,
    )
  }

  const cycleRecent = (direction: 1 | -1) => {
    const next = cycleModel(models.recent.list(), direction)

    if (next) model.set(next)
  }

  const cycleFavorite = (direction: 1 | -1) => {
    const next = cycleModel(models.favorite.list(), direction)

    if (!next) {
      showToast({ title: language.t("dialog.model.favorite.empty") })

      return
    }

    model.set(next, { recent: true })
  }

  const chooseModel = () => {
    const owner = sessionOwnership.capture()
    const editor = document.querySelector<HTMLElement>('[data-component="composer-editor"]')
    const selection = window.getSelection()

    const cursor =
      editor && selection?.rangeCount && editor.contains(selection.anchorNode) ? getCursorPosition(editor) : null

    const restoreComposer = () => {
      // Kobalte restores focus during its teardown effect; defer past it so the
      // composer keeps focus and the caret returns to where the user left it.
      requestAnimationFrame(() => {
        const editor = document.querySelector<HTMLElement>('[data-component="composer-editor"]')

        if (!editor) return
        editor.focus()

        if (cursor !== null) setCursorPosition(editor, cursor)
      })
    }

    owner.run(() => {
      void dialog.show(() => <DialogSelectModel model={model} />, restoreComposer)
    })
  }

  command.register("composer", () => [
    modelCommand({
      id: "model.choose",
      title: language.t("command.model.choose"),
      description: language.t("command.model.choose.description"),
      keybind: "mod+'",
      slash: "model",
      onSelect: chooseModel,
    }),
    modelCommand({
      id: "model.recent.next",
      title: language.t("command.model.recent.next"),
      description: language.t("command.model.recent.next.description"),
      keybind: "f2",
      editable: true,
      onSelect: () => cycleRecent(1),
    }),
    modelCommand({
      id: "model.recent.previous",
      title: language.t("command.model.recent.previous"),
      description: language.t("command.model.recent.previous.description"),
      keybind: "shift+f2",
      editable: true,
      onSelect: () => cycleRecent(-1),
    }),
    modelCommand({
      id: "model.favorite.next",
      title: language.t("command.model.favorite.next"),
      description: language.t("command.model.favorite.next.description"),
      onSelect: () => cycleFavorite(1),
    }),
    modelCommand({
      id: "model.favorite.previous",
      title: language.t("command.model.favorite.previous"),
      description: language.t("command.model.favorite.previous.description"),
      onSelect: () => cycleFavorite(-1),
    }),
    modelCommand({
      id: "model.variant.cycle",
      title: language.t("command.model.variant.cycle"),
      description: language.t("command.model.variant.cycle.description"),
      keybind: "shift+mod+d",
      onSelect: () => model.variant.cycle(),
    }),
    providerCommand({
      id: "provider.connect",
      title: language.t("command.provider.connect"),
      description: language.t("command.provider.connect.description"),
      slash: "connect",
      onSelect: connectProvider,
    }),
    agentCommand({
      id: "agent.cycle",
      title: language.t("command.agent.cycle"),
      description: language.t("command.agent.cycle.description"),
      keybind: "mod+.",
      slash: "agent",
      disabled: !local.agent.visible(),
      onSelect: () => local.agent.move(1),
    }),
    agentCommand({
      id: "agent.cycle.reverse",
      title: language.t("command.agent.cycle.reverse"),
      description: language.t("command.agent.cycle.reverse.description"),
      keybind: "shift+mod+.",
      disabled: !local.agent.visible(),
      onSelect: () => local.agent.move(-1),
    }),
  ])
}
