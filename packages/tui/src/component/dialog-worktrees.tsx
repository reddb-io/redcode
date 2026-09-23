import { TextAttributes } from "@opentui/core"
import { createMemo, createResource, onMount } from "solid-js"
import type { WorktreeInventoryInfo } from "@reddb-io/redcode-sdk/v2"
import { WorktreeInventory } from "@reddb-io/redcode-core/worktree-inventory"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { DialogConfirm } from "../ui/dialog-confirm"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useRoute } from "../context/route"
import { useTheme } from "../context/theme"
import { errorMessage } from "../util/error"

/**
 * The repository's worktrees, one compact row each (`⎇ .red/worktrees/x  ⑂ x  1.2G  dirty·3d`).
 * Enter moves the current session into the selected worktree; remove and clean ask first, and a
 * worktree with uncommitted changes needs a second, explicit confirmation.
 */
export function DialogWorktrees() {
  const sdk = useSDK()
  const sync = useSync()
  const route = useRoute()
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  onMount(() => dialog.setSize("xlarge"))

  const sessionID = () => (route.data.type === "session" ? route.data.sessionID : undefined)
  // The server protects the worktree of the directory it is asked from: the session's own.
  const directory = () => {
    const id = sessionID()
    return (id && sync.session.get(id)?.directory) || sdk.directory
  }

  const [inventory, { refetch }] = createResource(directory, (dir) =>
    sdk.client.worktree.inventory
      .list({ directory: dir, pullRequests: "true" }, { throwOnError: true })
      .then((result) => result.data),
  )

  const options = createMemo<DialogSelectOption<WorktreeInventoryInfo>[]>(() => {
    const now = Date.now()
    return (inventory()?.worktrees ?? []).map((item) => {
      const summary = WorktreeInventory.summary(item, now)
      return {
        title: `${summary.location}  ${summary.branch}`,
        truncateTitle: "left",
        value: item,
        footer: `${summary.size}  ${summary.state}${item.sessions.length > 0 ? `  ${item.sessions.length}◆` : ""}`,
        description: item.sessions[0]?.title,
      }
    })
  })

  const reopen = () => dialog.replace(() => <DialogWorktrees />)

  async function open(item: WorktreeInventoryInfo) {
    const id = sessionID()
    if (!id) {
      toast.show({ variant: "info", message: "Open a session to move it into a worktree." })
      return
    }
    await sdk.client.experimental.controlPlane
      .moveSession({ sessionID: id, destination: { directory: item.path }, moveChanges: false }, { throwOnError: true })
      .then(() => toast.show({ variant: "success", message: `Session moved to ${item.relative ?? item.path}` }))
      .catch((error) => toast.show({ variant: "error", message: errorMessage(error) }))
    dialog.clear()
  }

  async function remove(item: WorktreeInventoryInfo) {
    const name = item.relative ?? item.path
    const confirmed = await DialogConfirm.show(
      dialog,
      "Remove worktree",
      `Remove ${name}${item.branch ? ` (branch ${item.branch})` : ""}? ${item.merged ? "Its merged branch is deleted too." : "Its branch is kept."}`,
    )
    if (confirmed !== true) return reopen()
    const pending = item.changes.tracked + item.changes.untracked
    const force =
      pending > 0
        ? await DialogConfirm.show(
            dialog,
            "Discard uncommitted changes",
            `${name} has ${pending} uncommitted change${pending === 1 ? "" : "s"}. Removing it discards them for good.`,
            "Discard and remove",
          )
        : false
    if (pending > 0 && force !== true) return reopen()
    await sdk.client.worktree.inventory
      .remove(
        {
          directory: directory(),
          worktreeInventoryRemoveInput: { target: item.path, force: pending > 0, deleteBranch: true },
        },
        { throwOnError: true },
      )
      .then((result) =>
        toast.show({
          variant: "success",
          message: `Removed ${name}, freed ${WorktreeInventory.bytes(result.data.freed)}`,
        }),
      )
      .catch((error) => toast.show({ variant: "error", message: errorMessage(error) }))
    reopen()
  }

  async function clean() {
    const preview = await sdk.client.worktree.inventory
      .clean(
        { directory: directory(), worktreeInventoryCleanInput: { dryRun: true, pullRequests: true } },
        { throwOnError: true },
      )
      .then((result) => result.data)
      .catch((error) => {
        toast.show({ variant: "error", message: errorMessage(error) })
        return undefined
      })
    if (!preview) return
    if (preview.candidates.length === 0 && preview.pruned.length === 0) {
      toast.show({ variant: "info", message: "No clean merged worktrees to remove." })
      return
    }
    const confirmed = await DialogConfirm.show(
      dialog,
      "Clean merged worktrees",
      [
        `Remove ${preview.candidates.length} clean merged worktree${preview.candidates.length === 1 ? "" : "s"} and free ${WorktreeInventory.bytes(preview.freed)}?`,
        ...preview.candidates.map((item) => `  ${item.relative ?? item.path}`),
        ...(preview.pruned.length > 0 ? [`Also prune ${preview.pruned.length} stale registration(s).`] : []),
      ].join("\n"),
    )
    if (confirmed !== true) return reopen()
    await sdk.client.worktree.inventory
      .clean({ directory: directory(), worktreeInventoryCleanInput: { pullRequests: true } }, { throwOnError: true })
      .then((result) =>
        toast.show({
          variant: result.data.failed.length > 0 ? "warning" : "success",
          message: `Removed ${result.data.removed.length} worktree${result.data.removed.length === 1 ? "" : "s"}, freed ${WorktreeInventory.bytes(result.data.freed)}${result.data.failed.length > 0 ? `; kept ${result.data.failed.length} that could not be removed` : ""}`,
        }),
      )
      .catch((error) => toast.show({ variant: "error", message: errorMessage(error) }))
    reopen()
  }

  return (
    <DialogSelect
      title="Worktrees"
      placeholder="Filter worktrees"
      options={options()}
      locked={inventory.loading}
      emptyView={
        <box paddingLeft={4} paddingRight={4}>
          <text fg={inventory.error ? theme.error : theme.textMuted} attributes={TextAttributes.BOLD}>
            {inventory.error ? "Could not list worktrees" : inventory.loading ? "Loading worktrees…" : "No worktrees"}
          </text>
          {inventory.error ? <text fg={theme.textMuted}>{errorMessage(inventory.error)}</text> : undefined}
        </box>
      }
      onSelect={(option) => void open(option.value)}
      actions={[
        {
          command: "dialog.worktrees.remove",
          title: "remove",
          disabled: (option) => !option || option.value.primary || option.value.current,
          onTrigger: (option) => void remove(option.value),
        },
        {
          command: "dialog.worktrees.clean",
          title: "clean merged",
          onTrigger: () => void clean(),
        },
        {
          command: "dialog.worktrees.refresh",
          title: "refresh",
          onTrigger: () => void refetch(),
        },
      ]}
    />
  )
}
