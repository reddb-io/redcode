import { useNavigate } from "@solidjs/router"
import { useCommand, type CommandOption } from "@/context/command"
import { useDialog } from "@reddb-io/redcode-ui/context/dialog"
import { previewSelectedLines } from "@reddb-io/redcode-session-ui/pierre/selection-bridge"
import { useFile, selectionFromLines, type FileSelection, type SelectedLineRange } from "@/context/file"
import { useLayout } from "@/context/layout"
import { usePermission } from "@/context/permission"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { showToast } from "@/utils/toast"
import { downloadSessionExport, fetchSessionExport, sessionExportFilename } from "@/utils/session-export"
import { findLast } from "@reddb-io/redcode-core/util/array"
import { createSessionTabs } from "@/pages/session/helpers"
import { extractPromptFromParts } from "@/utils/prompt"
import { Message, Part, UserMessage } from "@reddb-io/redcode-sdk/v2"
import { useSessionLayout } from "@/pages/session/session-layout"
import { useSessionArchive } from "@/pages/session/session-archive"
import { createSessionOwnership } from "./session-ownership"
import { useLocal } from "@/context/local"
import { useGoalApi } from "@/utils/goal-api"

export type SessionCommandContext = {
  navigateMessageByOffset: (offset: number) => void
  setActiveMessage: (message: UserMessage | undefined) => void
  focusInput: () => void
  review?: () => boolean
  fileBrowser?: () => boolean
}

const withCategory = (category: string) => {
  return (option: Omit<CommandOption, "category">): CommandOption => ({
    ...option,
    category,
  })
}

export const useSessionCommands = (actions: SessionCommandContext) => {
  const command = useCommand()
  const dialog = useDialog()
  const file = useFile()
  const permission = usePermission()
  const prompt = usePrompt()
  const sdk = useSDK()
  const settings = useSettings()
  const sync = useSync()
  const terminal = useTerminal()
  const layout = useLayout()
  const local = useLocal()
  const goals = useGoalApi()
  const navigate = useNavigate()
  const { params, sessionKey, tabs, view } = useSessionLayout()
  const sessionOwnership = createSessionOwnership(sessionKey)
  const sessionArchive = useSessionArchive()
  const openDialog = async <T,>(load: () => Promise<T>, show: (value: T) => void) => {
    const owner = sessionOwnership.capture()
    const value = await load()
    owner.run(() => show(value))
  }
  const runCommand = async <T,>(input: {
    owner: ReturnType<ReturnType<typeof createSessionOwnership>["capture"]>
    prompt: T
    request: () => Promise<unknown>
    updatePrompt: (prompt: T) => void
    updateViewport: () => void
  }) => {
    await input.request()
    input.updatePrompt(input.prompt)
    input.owner.run(input.updateViewport)
  }

  const info = () => {
    const id = params.id
    if (!id) return
    return sync().session.get(id)
  }
  const hasReview = () => !!params.id
  const normalizeTab = (tab: string) => {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }
  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: actions.review,
    hasReview,
    fileBrowser: actions.fileBrowser,
  })
  const activeFileTab = tabState.activeFileTab
  const closableTab = tabState.closableTab
  const shown = settings.visibility.fileTree

  const messages = () => {
    const id = params.id
    if (!id) return []
    return sync().data.message[id] ?? []
  }
  const userMessages = () => messages().filter((m) => m.role === "user") as UserMessage[]
  const visibleUserMessages = () => {
    const revert = info()?.revert?.messageID
    if (!revert) return userMessages()
    const boundary = userMessages().findIndex((message) => message.id === revert)
    return boundary < 0 ? userMessages() : userMessages().slice(0, boundary)
  }

  const showAllFiles = () => {
    if (layout.fileTree.tab() !== "changes") return
    layout.fileTree.setTab("all")
  }

  const selectionPreview = (path: string, selection: FileSelection) => {
    const content = file.get(path)?.content?.content
    if (!content) return undefined
    return previewSelectedLines(content, { start: selection.startLine, end: selection.endLine })
  }

  const addSelectionToContext = (path: string, selection: FileSelection) => {
    const preview = selectionPreview(path, selection)
    prompt.context.add({ type: "file", path, selection, preview })
  }

  const canAddSelectionContext = () => {
    const tab = activeFileTab()
    if (!tab) return false
    const path = file.pathFromTab(tab)
    if (!path) return false
    return file.selectedLines(path) != null
  }

  const navigateMessageByOffset = actions.navigateMessageByOffset
  const setActiveMessage = actions.setActiveMessage
  const focusInput = actions.focusInput

  const sessionCommand = withCategory("Session")
  const fileCommand = withCategory("File")
  const contextCommand = withCategory("Context")
  const viewCommand = withCategory("View")
  const terminalCommand = withCategory("Terminal")
  const mcpCommand = withCategory("MCP")
  const permissionsCommand = withCategory("Permissions")

  const isAutoAcceptActive = () => {
    const sessionID = params.id
    if (sessionID) return permission.isAutoAccepting(sessionID, sdk().directory)
    return permission.isAutoAcceptingDirectory(sdk().directory)
  }
  const write = async (value: string) => {
    const body = typeof document === "undefined" ? undefined : document.body
    if (body) {
      const textarea = document.createElement("textarea")
      textarea.value = value
      textarea.setAttribute("readonly", "")
      textarea.style.position = "fixed"
      textarea.style.opacity = "0"
      textarea.style.pointerEvents = "none"
      body.appendChild(textarea)
      textarea.select()
      const copied = document.execCommand("copy")
      body.removeChild(textarea)
      if (copied) return true
    }

    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
    if (!clipboard?.writeText) return false
    return clipboard.writeText(value).then(
      () => true,
      () => false,
    )
  }

  const copyShare = async (url: string, existing: boolean) => {
    if (!(await write(url))) {
      showToast({
        title: "Failed to copy URL to clipboard",
        variant: "error",
      })
      return
    }

    showToast({
      title: existing ? "Copied" : "Session shared",
      description: "Share URL copied to clipboard!",
      variant: "success",
    })
  }

  const share = async () => {
    const sessionID = params.id
    if (!sessionID) return

    const existing = info()?.share?.url
    if (existing) {
      await copyShare(existing, true)
      return
    }

    const url = await sdk()
      .client.session.share({ sessionID })
      .then((res) => res.data?.share?.url)
      .catch(() => undefined)
    if (!url) {
      showToast({
        title: "Failed to share session",
        description: "An error occurred while sharing the session",
        variant: "error",
      })
      return
    }

    await copyShare(url, false)
  }

  const unshare = async () => {
    const sessionID = params.id
    if (!sessionID) return

    await sdk()
      .client.session.unshare({ sessionID })
      .then(() =>
        showToast({
          title: "Session unshared",
          description: "Session unshared successfully!",
          variant: "success",
        }),
      )
      .catch(() =>
        showToast({
          title: "Failed to unshare session",
          description: "An error occurred while unsharing the session",
          variant: "error",
        }),
      )
  }

  const exportSession = async () => {
    const sessionID = params.id
    if (!sessionID) return
    try {
      const data = await fetchSessionExport({
        sessionID,
        client: sdk().client,
      })
      const filename = sessionExportFilename(data.info)
      downloadSessionExport(filename, data)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "Session exported",
        description: `Saved session to ${filename}`,
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: "Failed to export session",
        description: err instanceof Error ? err.message : "An error occurred while exporting the session",
      })
    }
  }

  const openFile = () => {
    void openDialog(
      () => import("@/components/dialog-select-file"),
      (x) => dialog.show(() => <x.DialogSelectFile onOpenFile={showAllFiles} />),
    )
  }

  const closeTab = () => {
    const tab = closableTab()
    if (!tab) return
    tabs().close(tab)
  }

  const addSelection = () => {
    const tab = activeFileTab()
    if (!tab) return

    const path = file.pathFromTab(tab)
    if (!path) return

    const range = file.selectedLines(path) as SelectedLineRange | null | undefined
    if (!range) {
      showToast({
        title: "No line selection",
        description: "Select a line range in a file tab first.",
      })
      return
    }

    addSelectionToContext(path, selectionFromLines(range))
  }

  const openTerminal = () => {
    if (terminal.all().length > 0) terminal.new({ focus: true })
    if (terminal.all().length === 0) terminal.requestFocus()
    view().terminal.open()
  }

  const closeTerminal = () => {
    const id = terminal.active()
    if (!id) return
    const last = terminal.all().length === 1
    void terminal.close(id)
    if (last) view().terminal.close()
  }

  const chooseMcp = () => {
    void openDialog(
      () => import("@/components/dialog-select-mcp"),
      (x) => dialog.show(() => <x.DialogSelectMcp />),
    )
  }

  const toggleAutoAccept = () => {
    const sessionID = params.id
    if (sessionID) permission.toggleAutoAccept(sessionID, sdk().directory)
    else permission.toggleAutoAcceptDirectory(sdk().directory)

    const active = sessionID
      ? permission.isAutoAccepting(sessionID, sdk().directory)
      : permission.isAutoAcceptingDirectory(sdk().directory)
    showToast({
      title: active
        ? "Auto-accepting permissions"
        : "Stopped auto-accepting permissions",
      description: active
        ? "Permission requests will be automatically approved"
        : "Permission requests will require approval",
    })
  }

  const undo = async () => {
    const sessionID = params.id
    if (!sessionID) return
    const owner = sessionOwnership.capture()
    const session = sdk().api.session
    const directory = sdk().directory
    const promptSession = prompt.capture()
    const revert = info()?.revert?.messageID
    const messages = userMessages()
    const boundary = revert ? messages.findIndex((message) => message.id === revert) : messages.length
    if (boundary < 0) return
    const message = messages[boundary - 1]
    if (!message) return
    const parts = sync().data.part[message.id]

    if (sync().data.session_working(sessionID)) {
      await session.interrupt({ sessionID }).catch(() => {})
    }

    await runCommand({
      owner,
      prompt: promptSession,
      request: () => session.revert.stage({ sessionID, messageID: message.id }),
      updatePrompt: (promptSession) => {
        if (parts) promptSession.set(extractPromptFromParts(parts, { directory }))
      },
      updateViewport: () => setActiveMessage(messages[boundary - 2]),
    })
  }

  const redo = async () => {
    const sessionID = params.id
    if (!sessionID) return
    const owner = sessionOwnership.capture()
    const session = sdk().api.session
    const messages = userMessages()
    const promptSession = prompt.capture()

    const revertMessageID = info()?.revert?.messageID
    if (!revertMessageID) return

    const boundary = messages.findIndex((message) => message.id === revertMessageID)
    if (boundary < 0) return
    const next = messages[boundary + 1]
    if (!next) {
      await runCommand({
        owner,
        prompt: promptSession,
        request: () => session.revert.clear({ sessionID }),
        updatePrompt: (promptSession) => promptSession.reset(),
        updateViewport: () => setActiveMessage(messages.at(-1)),
      })
      return
    }

    await runCommand({
      owner,
      prompt: promptSession,
      request: () => session.revert.stage({ sessionID, messageID: next.id }),
      updatePrompt: () => undefined,
      updateViewport: () => setActiveMessage(messages[boundary]),
    })
  }

  const compact = async () => {
    const sessionID = params.id
    if (!sessionID) return

    const model = local.model.current()
    if (!model) {
      showToast({
        title: "No model selected",
        description: "Connect a provider to summarize this session",
      })
      return
    }

    await sdk().api.session.compact({
      sessionID,
      model: { providerID: model.provider.id, modelID: model.id },
    })
  }

  const fork = () => {
    void openDialog(
      () => import("@/components/dialog-fork"),
      (x) => dialog.show(() => <x.DialogFork />),
    )
  }

  const shareCmds = () => {
    if (sync().data.config.share === "disabled") return []
    return [
      sessionCommand({
        id: "session.share",
        title: info()?.share?.url ? "Copy link" : "Share session",
        description: info()?.share?.url
          ? "Share URL copied to clipboard!"
          : "Share this session and copy the URL to clipboard",
        slash: "share",
        disabled: !params.id,
        onSelect: share,
      }),
      sessionCommand({
        id: "session.unshare",
        title: "Unshare session",
        description: "Stop sharing this session",
        slash: "unshare",
        disabled: !params.id || !info()?.share?.url,
        onSelect: unshare,
      }),
    ]
  }

  const sessionCmds = () => [
    sessionCommand({
      id: "session.new",
      title: "New session",
      keybind: "mod+shift+s",
      slash: "new",
      onSelect: (source) => {
        if (settings.general.newLayoutDesigns()) {
          command.trigger("tab.new", source)
          return
        }
        navigate(`/${params.dir}/session`)
      },
    }),
    sessionCommand({
      id: "session.undo",
      title: "Undo",
      description: "Undo the last message",
      slash: "undo",
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: undo,
    }),
    sessionCommand({
      id: "session.redo",
      title: "Redo",
      description: "Redo the last undone message",
      slash: "redo",
      disabled: !params.id || !info()?.revert?.messageID,
      onSelect: redo,
    }),
    sessionCommand({
      id: "session.goal",
      title: "Set goal",
      description: "Give this session a definition of done and pursue it until it holds",
      slash: "goal",
      disabled: !params.id,
      onSelect: () =>
        void Promise.all([import("@/components/dialog-goal"), goals.current()]).then(([x, current]) =>
          dialog.show(() => (
            <x.DialogGoal
              current={current}
              onSubmit={async (text, options) => {
                const sessionID = params.id
                if (!sessionID) return
                if (await goals.current()) {
                  const model = local.model.current()
                  const goal = await goals.set({
                    sessionID,
                    objective: text,
                    agent: local.agent.current()?.name,
                    model: model
                      ? { id: model.id, providerID: model.provider.id, variant: local.model.variant.current() }
                      : undefined,
                    maxTurns: options.maxTurns,
                    executePlan: options.executePlan,
                    ...(options.executePlan ? { stopAfter: "build" } : {}),
                  })
                  showToast({
                    title: "Set goal",
                    description: `${goal.turns.used}/${goal.turns.max} provider turns`,
                  })
                  return
                }
                const result = await sdk().client.session.goalSet({
                  sessionID,
                  text,
                  agent: local.agent.current()?.name,
                  max_turns: options.maxTurns,
                })
                if (result.data) {
                  showToast({
                    title: "Set goal",
                    description: `${result.data.turns.max} turns`,
                  })
                } else {
                  showToast({
                    title: "Set goal",
                    description: "Could not set the goal.",
                  })
                }
              }}
            />
          )),
        ),
    }),
    sessionCommand({
      id: "session.goal.pause",
      title: "Pause goal",
      slash: "goal-pause",
      disabled: !params.id,
      onSelect: async () => {
        const sessionID = params.id
        if (!sessionID) return
        if (await goals.current()) await goals.control({ sessionID, action: "pause" })
        else await sdk().client.session.goalPause({ sessionID })
      },
    }),
    sessionCommand({
      id: "session.goal.resume",
      title: "Resume goal",
      slash: "goal-resume",
      disabled: !params.id,
      onSelect: async () => {
        const sessionID = params.id
        if (!sessionID) return
        if (await goals.current()) await goals.control({ sessionID, action: "resume" })
        else await sdk().client.session.goalResume({ sessionID })
      },
    }),
    sessionCommand({
      id: "session.goal.drop",
      title: "Drop goal",
      slash: "goal-drop",
      disabled: !params.id,
      onSelect: async () => {
        const sessionID = params.id
        if (!sessionID) return
        if (await goals.current()) await goals.control({ sessionID, action: "drop" })
        else await sdk().client.session.goalDrop({ sessionID })
      },
    }),
    sessionCommand({
      id: "session.compact",
      title: "Compact session",
      description: "Summarize the session to reduce context size",
      slash: "compact",
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: compact,
    }),
    sessionCommand({
      id: "session.fork",
      title: "Fork from message",
      description: "Create a new session from a previous message",
      slash: "fork",
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: fork,
    }),
    sessionCommand({
      id: "session.export",
      title: "Export session",
      description: "Export the full session transcript as JSON",
      slash: "export",
      disabled: !params.id,
      onSelect: exportSession,
    }),
    sessionCommand({
      id: "session.archive",
      title: "Archive session",
      keybind: "mod+shift+backspace",
      disabled: !params.id,
      onSelect: () => {
        const id = params.id
        if (id) void sessionArchive.archive(id)
      },
    }),
  ]

  const fileCmds = () => {
    const tab = closableTab()
    return [
      fileCommand({
        id: "file.open",
        title: "Open file",
        description: "Search files, commands, and sessions",
        keybind: "mod+p",
        slash: "open",
        onSelect: openFile,
      }),
      tab &&
        fileCommand({
          id: "tab.close",
          title: "Close tab",
          keybind: "mod+w",
          onSelect: closeTab,
        }),
    ].filter((v) => !!v)
  }

  const contextCmds = () => [
    contextCommand({
      id: "context.addSelection",
      title: "Add selection to context",
      description: "Add selected lines from the current file",
      keybind: "mod+shift+l",
      disabled: !canAddSelectionContext(),
      onSelect: addSelection,
    }),
  ]

  const viewCmds = () => [
    viewCommand({
      id: "terminal.toggle",
      title: "Toggle terminal",
      keybind: "ctrl+`",
      slash: "terminal",
      onSelect: () => {
        if (view().terminal.opened()) {
          terminal.cancelFocus()
          view().terminal.close()
          return
        }
        terminal.requestFocus(terminal.active())
        view().terminal.open()
      },
    }),
    viewCommand({
      id: "review.toggle",
      title: "Toggle review",
      keybind: "mod+shift+r",
      onSelect: () => view().reviewPanel.toggle(),
    }),
    ...(shown()
      ? [
          viewCommand({
            id: "fileTree.toggle",
            title: "Toggle file tree",
            keybind: "mod+\\",
            onSelect: () => layout.fileTree.toggle(),
          }),
        ]
      : []),
    viewCommand({
      id: "input.focus",
      title: "Focus input",
      keybind: "ctrl+l",
      onSelect: focusInput,
    }),
  ]

  const terminalCmds = () => [
    terminalCommand({
      id: "terminal.close",
      title: "Close terminal",
      keybind: "mod+w",
      hidden: true,
      when: (event) => event.target instanceof Element && !!event.target.closest('[data-component="terminal"]'),
      onSelect: closeTerminal,
    }),
    terminalCommand({
      id: "terminal.new",
      title: "New terminal",
      description: "Create a new terminal tab",
      keybind: "ctrl+alt+t",
      onSelect: openTerminal,
    }),
  ]

  const messageCmds = () => [
    sessionCommand({
      id: "message.previous",
      title: "Previous message",
      description: "Go to the previous user message",
      keybind: "mod+alt+[",
      disabled: !params.id,
      onSelect: () => navigateMessageByOffset(-1),
    }),
    sessionCommand({
      id: "message.next",
      title: "Next message",
      description: "Go to the next user message",
      keybind: "mod+alt+]",
      disabled: !params.id,
      onSelect: () => navigateMessageByOffset(1),
    }),
  ]

  const mcpCmds = () => [
    mcpCommand({
      id: "mcp.toggle",
      title: "Toggle MCPs",
      description: "Toggle MCPs",
      keybind: "mod+;",
      slash: "mcp",
      onSelect: chooseMcp,
    }),
  ]

  const permissionsCmds = () => [
    permissionsCommand({
      id: "permissions.autoaccept",
      title: isAutoAcceptActive()
        ? "Stop auto-accepting permissions"
        : "Auto-accept permissions",
      keybind: "mod+shift+a",
      disabled: false,
      onSelect: toggleAutoAccept,
    }),
  ]

  command.register("session", () => [
    ...sessionCmds(),
    ...shareCmds(),
    ...fileCmds(),
    ...contextCmds(),
    ...viewCmds(),
    ...terminalCmds(),
    ...messageCmds(),
    ...mcpCmds(),
    ...permissionsCmds(),
  ])
}
