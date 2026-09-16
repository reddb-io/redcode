import { createEffect, untrack } from "solid-js"
import { useSync } from "../context/sync"
import { useDialog, type DialogContext } from "../ui/dialog"
import { useToast } from "../ui/toast"
import type { BrowserOpener } from "../util/browser"
import { DialogMcp } from "./dialog-mcp"
import { DialogMcpAuth, isSigningIn } from "./dialog-mcp-auth"
import { useProject } from "../context/project"
import { McpAuthPrompt } from "./mcp-auth-prompt"

const PROMPT_DURATION_MS = 15_000

/** Open the sign-in dialog unless one for this server is already on screen (no second browser tab). */
export function openMcpAuth(dialog: Pick<DialogContext, "replace">, name: string, opener?: BrowserOpener) {
  if (isSigningIn(name)) return false
  dialog.replace(() => <DialogMcpAuth name={name} opener={opener} />)
  return true
}

/** Servers that need authentication right now, sorted by name. */
export function needsAuth(statuses: Readonly<Record<string, { readonly status: string }>>) {
  return Object.entries(statuses)
    .filter(([, item]) => item.status === "needs_auth")
    .map(([name]) => name)
    .sort()
}

/**
 * Prompt once, with an Authenticate action, whenever an MCP server enters `needs_auth`: at startup, after
 * a reload, or when a token expires or fails to refresh mid-session.
 */
export function useMcpAuthPrompts(input: { opener?: BrowserOpener } = {}) {
  const sync = useSync()
  const toast = useToast()
  const dialog = useDialog()
  const project = useProject()
  const track = McpAuthPrompt.createTracker()

  createEffect(() => {
    const workspace = project.workspace.current()
    const snapshot = Object.fromEntries(
      Object.entries(sync.data.mcp).map(([name, item]) => [name, { status: item.status }]),
    )
    // A server whose sign-in dialog is already open needs no prompt.
    const entered = track(snapshot, workspace).filter((name) => !isSigningIn(name))
    if (entered.length === 0) return
    untrack(() => {
      if (entered.length === 1) {
        const name = entered[0]
        toast.show({
          variant: "warning",
          title: "MCP sign-in needed",
          message: `${name} needs authentication before its tools can be used. You can also run /mcp.`,
          duration: PROMPT_DURATION_MS,
          action: { label: "Authenticate", run: () => openMcpAuth(dialog, name, input.opener) },
        })
        return
      }
      toast.show({
        variant: "warning",
        title: "MCP sign-in needed",
        message: `${entered.join(", ")} need authentication before their tools can be used.`,
        duration: PROMPT_DURATION_MS,
        action: { label: "Open MCP servers", run: () => dialog.replace(() => <DialogMcp opener={input.opener} />) },
      })
    })
  })
}
