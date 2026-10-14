import { Plugin } from "@opencode/plugin/tui"
import { AgentTools } from "@opencode/schema/agent-tools"
import { Schema } from "effect"
import { createStore } from "solid-js/store"
import { DialogSelect } from "../../ui/dialog-select"
import { errorMessage } from "../../util/error"

export default Plugin.define({
  id: "redcode.agent-tools",
  setup(context) {
    const controller = new AbortController()
    const [state, setState] = createStore<{ snapshot?: AgentTools.Snapshot; busy: boolean }>({ busy: false })
    const load = async () => {
      const snapshot = Schema.decodeUnknownSync(AgentTools.Snapshot)(
        await context.client.agentTools.list({ signal: controller.signal }),
      )
      if (!controller.signal.aborted) setState("snapshot", snapshot)
    }
    const run = async (action: () => Promise<unknown>) => {
      if (state.busy) return
      setState("busy", true)
      try {
        await action()
        await load()
      } catch (error) {
        if (!controller.signal.aborted) context.ui.toast.show({ variant: "error", message: errorMessage(error) })
      } finally {
        if (!controller.signal.aborted) setState("busy", false)
      }
    }
    const current = (id: AgentTools.ID) => state.snapshot?.tools.find((tool) => tool.id === id)
    const configure = async (id: AgentTools.ID) => {
      const item = current(id)
      if (!item) return
      const answer = await context.ui.dialog.prompt({
        title: `${id}: custom ${id === "rift" ? "CLI" : "MCP"} command`,
        value: item.settings.command ? JSON.stringify(item.settings.command) : "",
        placeholder: "JSON array; leave blank for managed installation",
      })
      if (answer === undefined) return
      await run(async () => {
        const command = answer.trim()
          ? Schema.decodeUnknownSync(Schema.fromJsonString(AgentTools.Command))(answer)
          : undefined
        return context.client.agentTools.configure({
          id,
          settings: {
            enabled: item.settings.enabled,
            timeout: item.settings.timeout,
            copyAll: item.settings.copyAll,
            ...(command ? { command } : {}),
          },
        })
      })
      show()
    }
    const timeout = async (id: AgentTools.ID) => {
      const item = current(id)
      if (!item) return
      const answer = await context.ui.dialog.prompt({
        title: "Execution timeout in milliseconds",
        value: String(item.settings.timeout ?? 120_000),
      })
      if (answer === undefined) return
      await run(() =>
        context.client.agentTools.configure({ id, settings: { ...item.settings, timeout: Number(answer) } }),
      )
      show()
    }
    const initialize = async () => {
      const answer = await context.ui.dialog.prompt({
        title: "Initialize Rift source on the connected host",
        placeholder: "Absolute source directory; btrfs may convert it to a subvolume",
      })
      if (!answer?.trim()) return
      await run(() => context.client.agentTools.initialize({ directory: answer.trim() }))
      show()
    }
    const show = () => {
      if (controller.signal.aborted) return
      context.ui.dialog.show(() => (
        <DialogSelect
          title={`Agent tools · ${state.snapshot?.host.name ?? "connected host"}`}
          locked={state.busy}
          preserveSelection
          options={(state.snapshot?.tools ?? []).map((tool) => ({
            value: tool.id,
            title: tool.id,
            footer: !tool.supported
              ? "unsupported"
              : tool.settings.enabled
                ? "enabled"
                : tool.installed
                  ? "installed"
                  : "not installed",
            details: [
              "Shared by CLI, TUI and Desktop on this host; controls use this host's desktop.",
              ...(tool.extensionDirectory ? [`Browser extension: ${tool.extensionDirectory}`] : []),
              ...(tool.diagnosis ? [tool.diagnosis] : []),
            ],
            detailsWrap: true,
          }))}
          onSelect={(option) => {
            const item = current(option.value)
            if (item && (item.settings.enabled || (item.supported && item.installed)))
              void run(() =>
                context.client.agentTools.configure({
                  id: item.id,
                  settings: { ...item.settings, enabled: !item.settings.enabled },
                }),
              )
          }}
          actions={[
            {
              command: "agent-tools.install",
              title: "install",
              bind: "ctrl+i",
              disabled: (option) => !option || !current(option.value)?.supported,
              onTrigger: (option) => void run(() => context.client.agentTools.install({ id: option.value })),
            },
            {
              command: "agent-tools.probe",
              title: "diagnose",
              bind: "ctrl+d",
              disabled: (option) => !option || !current(option.value)?.installed,
              onTrigger: (option) => void run(() => context.client.agentTools.probe({ id: option.value })),
            },
            {
              command: "agent-tools.configure",
              title: "command",
              bind: "ctrl+e",
              onTrigger: (option) => void configure(option.value),
            },
            { command: "agent-tools.timeout", title: "timeout", onTrigger: (option) => void timeout(option.value) },
            {
              command: "agent-tools.copy-all",
              title: "toggle Rift caches",
              hidden: !current("rift")?.settings.enabled,
              onTrigger: () => {
                const item = current("rift")
                if (item)
                  void run(() =>
                    context.client.agentTools.configure({
                      id: "rift",
                      settings: { ...item.settings, copyAll: !item.settings.copyAll },
                    }),
                  )
              },
            },
            {
              command: "agent-tools.initialize",
              title: "initialize Rift",
              hidden: !current("rift")?.installed || !current("rift")?.supported,
              onTrigger: () => void initialize(),
            },
            { command: "agent-tools.refresh", title: "refresh", selection: "none", onTrigger: () => void run(load) },
          ]}
          footerHints={[{ title: "enter", label: "enable / disable" }]}
        />
      ))
    }
    context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "agent-tools.open",
              title: "Agent tools settings",
              group: "System",
              slash: { name: "agent-tools" },
              palette: true,
              run: () =>
                void run(async () => {
                  await load()
                  show()
                }),
            },
          ],
        }))
        return null
      },
    })
    return () => controller.abort()
  },
})
