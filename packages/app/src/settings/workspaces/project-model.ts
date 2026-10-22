import { getFilename } from "@opencode/util/path"
import type { ProjectUpdateInput } from "@opencode/client/promise"
import { settingsState } from "../state"
import type { LocalProject } from "@/shell/state/layout"

type ProjectPatch = Pick<ProjectUpdateInput, "name" | "icon" | "commands">

export function createEditProjectModel(props: {
  project: LocalProject
  persist: (patch: ProjectPatch) => Promise<void>
  notify: (error: unknown) => void
}) {
  const folderName = () => getFilename(props.project.worktree)
  const defaultName = () => props.project.name || folderName()

  const state = settingsState({
    name: defaultName(),
    color: props.project.icon?.color,
    iconOverride: props.project.icon?.override,
    startup: props.project.commands?.start ?? "",
    dragOver: false,
    iconHover: false,
    saving: 0,
  })

  const saved = {
    name: props.project.name ?? "",
    startup: state.getSnapshot().startup.trim(),
    color: state.getSnapshot().color,
    iconOverride: state.getSnapshot().iconOverride,
  }

  let iconInput: HTMLInputElement | undefined
  let queue = Promise.resolve()

  const persist = (patch: ProjectPatch, complete: () => void) => {
    state.update({ saving: state.getSnapshot().saving + 1 })
    queue = queue
      .then(() => props.persist(patch))
      .then(complete)
      .catch(props.notify)
      .finally(() => state.update({ saving: state.getSnapshot().saving - 1 }))
  }

  const saveName = () => {
    const value = state.getSnapshot().name.trim() === folderName() ? "" : state.getSnapshot().name.trim()

    // A pending write can change the saved value, so reverting to it must still be queued.
    if (!state.getSnapshot().saving && value === saved.name) return
    persist({ name: value }, () => {
      saved.name = value
    })
  }

  const saveStartup = () => {
    const value = state.getSnapshot().startup.trim()

    if (!state.getSnapshot().saving && value === saved.startup) return
    persist({ commands: { start: value } }, () => {
      saved.startup = value
    })
  }

  const saveIcon = (color = state.getSnapshot().color, override = state.getSnapshot().iconOverride) => {
    if (!state.getSnapshot().saving && color === saved.color && override === saved.iconOverride) return
    persist({ icon: { color: color ?? "", override: override ?? "" } }, () => {
      saved.color = color
      saved.iconOverride = override
    })
  }

  function selectFile(file: File) {
    if (!file.type.startsWith("image/")) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const result = event.target?.result

      if (typeof result !== "string") return
      state.update({ iconOverride: result })
      state.update({ iconHover: false })
      saveIcon(state.getSnapshot().color, result)
    }

    reader.readAsDataURL(file)
  }

  return {
    source: state,
    update: state.update,
    folderName,
    defaultName,
    saveName,
    saveStartup,
    setColor(value: string | undefined) {
      state.update({ color: value })
      saveIcon(value, state.getSnapshot().iconOverride)
    },
    drop(event: DragEvent) {
      event.preventDefault()
      state.update({ dragOver: false })
      const file = event.dataTransfer?.files[0]

      if (file) selectFile(file)
    },
    dragOver(event: DragEvent) {
      event.preventDefault()
      state.update({ dragOver: true })
    },
    dragLeave() {
      state.update({ dragOver: false })
    },
    inputChange(input: HTMLInputElement) {
      const file = input.files?.[0]

      if (file) selectFile(file)
    },
    iconClick() {
      if (state.getSnapshot().iconOverride && state.getSnapshot().iconHover) {
        state.update({ iconOverride: "" })
        saveIcon(state.getSnapshot().color, "")

        return
      }

      iconInput?.click()
    },
    setIconInput(input: HTMLInputElement) {
      iconInput = input
    },
  }
}
