import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useMcpToggle } from "@/providers/connect/mcp"
import { ReactView } from "@/runtime/react/view"
import { sharedSource, type SharedSource } from "@/runtime/react/source"
import { settingsLanguage, type SettingsLanguage } from "../shared.react"
import type { SettingsView } from "../surface"
import { Extensions } from "./extensions.react"

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
  pending: boolean
  pendingName?: string
}
export function createExtensionsServices(
  props: { subtab?: SettingsView["subtab"]; onSubtab: (value: SettingsView["subtab"]) => void },
  directory?: () => string,
) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const data = useData()
  const toggle = useMcpToggle(() => directory?.())
  const ref = () => (directory ? { directory: directory() } : undefined)
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
    pending: toggle.isPending,
    pendingName: typeof toggle.variables === "string" ? toggle.variables : toggle.variables?.name,
  }))
  return {
    snapshot,
    select: (value: SettingsView["subtab"]) => props.onSubtab(value),
    toggle: (name: string) => toggle.mutate(name),
    load: () =>
      Promise.all([
        data.location.mcp.server.sync(),
        data.location.skill.sync(),
        ...(directory ? [data.location.mcp.server.sync(ref()), data.location.skill.sync(ref())] : []),
      ]).catch(() => undefined),
    onConfigUpdate(callback: () => void) {
      return sdk.event.on("config.updated", (event) => {
        if (event.location && event.location.directory !== directory?.()) return
        callback()
      })
    },
  }
}
export function SettingsExtensions(props: {
  subtab?: SettingsView["subtab"]
  onSubtab: (value: SettingsView["subtab"]) => void
}) {
  const services = createExtensionsServices(props)
  return <ReactView component={Extensions} props={{ services }} />
}
