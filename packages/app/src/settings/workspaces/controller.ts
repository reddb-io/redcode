import { settingsState } from "../state"
import { pathKey } from "@/workspaces/path-key"
import { removeWorkspacesSequentially, type WorkspaceDeleteInspection } from "@/workspaces/paths"
import type { Workspace, WorkspaceContext, WorkspacesServices } from "./workspaces"

export type WorkspaceConfirmation = {
  kind: "single" | "all" | "empty"
  inventory: Workspace[]
  context: WorkspaceContext
}
export function createWorkspacesController(services: WorkspacesServices) {
  const state = settingsState({
    project: "all",
    transaction: undefined as "confirm" | "running" | undefined,
    deleting: [] as string[],
    removing: [] as string[],
    confirmation: undefined as WorkspaceConfirmation | undefined,
  })
  const language = () => services.snapshot.getSnapshot().language
  const inspectionMessages = (result: WorkspaceDeleteInspection) =>
    [
      result.linked ? language().t("settings.workspaces.delete.blocked.linked") : undefined,
      result.dirty ? language().t("workspace.status.dirty") : undefined,
    ].filter((message): message is string => message !== undefined)
  const failure = (error: unknown) =>
    services.notify({
      variant: "error",
      title: language().t("workspace.delete.failed.title"),
      description: error instanceof Error ? error.message : language().t("common.requestFailed"),
    })
  const remove = async (workspace: Workspace, force: boolean, context: WorkspaceContext) => {
    const key = String(pathKey(workspace.directory))
    state.update({ deleting: [...state.getSnapshot().deleting, key] })
    try {
      const preflight = await context.inspect(workspace)
      if (!force && (preflight.result.active || preflight.result.linked || preflight.result.dirty)) {
        services.notify({
          variant: "error",
          title: language().t("workspace.delete.failed.title"),
          description: preflight.result.active
            ? language().t("settings.workspaces.delete.blocked.active")
            : inspectionMessages(preflight.result)[0],
        })
        return
      }
      const removed = await context.remove(workspace, force).then(
        () => true,
        (error) => {
          failure(error)
          return false
        },
      )
      if (!removed) return
      state.update({ removing: [...state.getSnapshot().removing, key] })
      await new Promise((resolve) => setTimeout(resolve, 150))
      await context.complete(workspace)
    } finally {
      state.update({
        deleting: state.getSnapshot().deleting.filter((item) => item !== key),
        removing: state.getSnapshot().removing.filter((item) => item !== key),
      })
    }
  }
  return {
    source: state,
    update: state.update,
    inspectionMessages,
    confirm(kind: WorkspaceConfirmation["kind"], inventory: Workspace[]) {
      if (state.getSnapshot().transaction || !inventory.length) return
      state.update({
        transaction: "confirm",
        confirmation: { kind, inventory: [...inventory], context: services.capture() },
      })
    },
    cancel() {
      if (state.getSnapshot().transaction === "confirm")
        state.update({ transaction: undefined, confirmation: undefined })
    },
    async remove() {
      const confirmation = state.getSnapshot().confirmation
      if (state.getSnapshot().transaction !== "confirm" || !confirmation) return
      state.update({ transaction: "running", confirmation: undefined })
      await removeWorkspacesSequentially(confirmation.inventory, (workspace) =>
        remove(workspace, confirmation.kind === "single", confirmation.context),
      ).catch(failure)
      state.update({ transaction: undefined })
    },
  }
}
