import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { usePlatform } from "@/runtime/platform/platform"
import { useMcpToggle } from "@/providers/connect/mcp"
import { ReactView } from "@/runtime/react/view"
import { sharedSource, type SharedSource } from "@/runtime/react/source"
import { sharedMount } from "@/runtime/react/mount"
import { ExtensionSettingsSections } from "@/runtime/extension/settings-page-view"
import { ServerConnection } from "@/runtime/server/registry"
import type { PluginInfo } from "@opencode/client/promise"
import type { Installed } from "@opencode/gui-extensions/sdk/bridge"
import { createSignal, onCleanup } from "solid-js"
import { settingsLanguage, type SettingsLanguage } from "../shared.react"
import type { SettingsView } from "../surface"
import { Extensions } from "./extensions.react"
import { createAgentToolsServices } from "../agent-tools/agent-tools"

type Skill = { name: string; path: string }
export type ExtensionsSnapshot = {
  language: SettingsLanguage
  api: ReturnType<typeof useServerSDK>["api"]
  connected: boolean
  directory?: string
  subtab: NonNullable<SettingsView["subtab"]>
  mcps: { name: string; enabled: boolean }[]
  globalMcps: string[]
  skills: Skill[]
  globalSkills: Skill[]
  plugins: PluginInfo[]
  projectPlugins: PluginInfo[]
  desktopExtensions: readonly Installed[]
  desktopPackaged: boolean
  pending: boolean
  pendingName?: string
}
export function createExtensionsServices(
  props: { subtab?: SettingsView["subtab"]; onSubtab: (value: SettingsView["subtab"]) => void },
  directory?: () => string,
) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const platform = usePlatform()
  const data = useData()
  const toggle = useMcpToggle(() => directory?.())
  const ref = () => (directory ? { directory: directory() } : undefined)
  const bridge = sdk.server.type === "sidecar" ? platform.extensions : undefined
  const [plugins, setPlugins] = createSignal<PluginInfo[]>([])
  const [projectPlugins, setProjectPlugins] = createSignal<PluginInfo[]>([])
  const [desktopExtensions, setDesktopExtensions] = createSignal<readonly Installed[]>([])
  const loadPlugins = async (check = false) => {
    const operation = check ? sdk.api.plugin.check : sdk.api.plugin.list
    const [global, project] = await Promise.all([
      operation(),
      directory ? operation({ location: { directory: directory() } }) : Promise.resolve(undefined),
    ])
    setPlugins(global.data)
    setProjectPlugins(project?.data ?? [])
  }
  const loadDesktop = async () => {
    if (!bridge) return
    setDesktopExtensions(await bridge.manager.list())
  }
  if (bridge) {
    void loadDesktop().catch(() => undefined)
    onCleanup(
      bridge.on((message) => {
        if (message.type === "extensions") setDesktopExtensions(message.list)
      }),
    )
  }
  const snapshot: SharedSource<ExtensionsSnapshot> = sharedSource(() => ({
    language: settingsLanguage(language),
    api: sdk.api,
    connected: sdk.connection.status() === "connected",
    directory: directory?.(),
    subtab: props.subtab ?? "mcps",
    mcps: (data.location.mcp.server.list(ref()) ?? []).map((server) => ({
      name: server.name,
      enabled: server.status.status === "connected",
    })),
    globalMcps: (data.location.mcp.server.list() ?? []).map((server) => server.name),
    skills: (data.location.skill.list(ref()) ?? []).map((item) => ({ name: item.name, path: item.path })),
    globalSkills: (data.location.skill.list() ?? []).map((item) => ({ name: item.name, path: item.path })),
    plugins: plugins(),
    projectPlugins: projectPlugins(),
    desktopExtensions: desktopExtensions(),
    desktopPackaged: bridge?.packaged ?? true,
    pending: toggle.isPending,
    pendingName: typeof toggle.variables === "string" ? toggle.variables : toggle.variables?.name,
  }))
  return {
    snapshot,
    pluginSections: sharedMount(() => (
      <>
        <ExtensionSettingsSections
          page="extensions"
          server={String(ServerConnection.key(sdk.server))}
          directory={directory?.()}
        />
        <ExtensionSettingsSections
          page="extensions"
          section="plugins"
          server={String(ServerConnection.key(sdk.server))}
          directory={directory?.()}
        />
      </>
    )),
    select: (value: SettingsView["subtab"]) => props.onSubtab(value),
    toggle: (name: string) => toggle.mutate(name),
    load: () =>
      Promise.all([
        data.location.mcp.server.sync(),
        data.location.skill.sync(),
        loadPlugins(),
        ...(directory ? [data.location.mcp.server.sync(ref()), data.location.skill.sync(ref())] : []),
      ]).catch(() => undefined),
    checkPlugins: () => loadPlugins(true),
    updatePlugin: async (target: string, project = false) => {
      await sdk.api.plugin.update({
        targets: [target],
        ...(project && directory ? { location: { directory: directory() } } : {}),
      })
      await loadPlugins(true)
    },
    setDesktopExtension: async (id: string, enabled: boolean) => {
      if (!bridge) return
      await (enabled ? bridge.manager.enable(id) : bridge.manager.disable(id))
      await loadDesktop()
    },
    reloadDesktopExtension: async (id: string) => {
      if (!bridge) return
      await bridge.manager.reload(id)
      await loadDesktop()
    },
    onConfigUpdate(callback: () => void) {
      return sdk.event.on("config.updated", (event) => {
        if (event.location && event.location.directory !== directory?.()) return
        callback()
      })
    },
    onPluginUpdate(callback: () => void) {
      return sdk.event.on("plugin.updated", () => {
        void loadPlugins().finally(callback)
      })
    },
  }
}
export function SettingsExtensions(props: {
  subtab?: SettingsView["subtab"]
  onSubtab: (value: SettingsView["subtab"]) => void
}) {
  const services = createExtensionsServices(props)
  const tools = createAgentToolsServices()
  return <ReactView component={Extensions} props={{ services, tools }} />
}
