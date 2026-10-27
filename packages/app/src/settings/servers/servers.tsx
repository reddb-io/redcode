import { Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useDialog } from "@opencode/ui/context/dialog"
import { ServerRowMenu } from "@/servers/registry/row-menu"
import { ServerHealthIndicator } from "@/servers/registry/row"
import { ExtensionServerRow } from "@/servers/registry/extension-row"
import { AddServerMenu } from "@/servers/registry/add-menu"
import { useLanguage } from "@/runtime/i18n/language"
import { useGlobal } from "@/runtime/server/runtime"
import { serverName } from "@/runtime/server/registry"
import type { ServerConnection } from "@/runtime/server/registry"
import { useServerCollectionController } from "@/servers/registry/controller"
import { DialogServer } from "@/servers/connect/dialog"
import { DialogShareServer } from "@/servers/connect/share-dialog"
import { DialogHttpsAccess } from "@/servers/connect/https-dialog"
import { showToast } from "@/shell/notifications/toast"
import { ReactView } from "@/runtime/react/view"
import { sharedSource } from "@/runtime/react/source"
import { sharedMount } from "@/runtime/react/mount"
import { settingsLanguage } from "../shared.react"
import type { ShellOption } from "../general/behavior"
import type { SettingsServer } from "./inventory"
import { ServerGeneral } from "./view.react"
import { VoiceSettings } from "@/composer/voice"

export function createServerGeneralServices(props: {
  entry: SettingsServer
  nested?: boolean
  onAddServer?: () => void
  onServerChange?: (server: ServerConnection.Any) => void
}) {
  const navigate = useNavigate()
  const dialog = useDialog()
  const language = useLanguage()
  const global = useGlobal()
  const registry = useServerCollectionController()
  const health = () => registry.collection.health()[props.entry.key]
  const edit = (server: ServerConnection.Http) =>
    void dialog.push(() => <DialogServer mode="edit" server={server} onSave={props.onServerChange} />)
  const context = () => (props.entry.connection ? global.ensureServerCtx(props.entry.connection) : undefined)
  return {
    snapshot: sharedSource(() => ({
      language: settingsLanguage(language),
      key: props.entry.key,
      name: props.entry.name,
      nested: !!props.nested,
      add: !props.nested && !!props.onAddServer,
      contributed: !!props.entry.source?.entry.row,
      connection: props.entry.connection
        ? { name: serverName(props.entry.connection) || props.entry.key, url: props.entry.connection.http.url }
        : undefined,
      unauthorized: !!health()?.unauthorized,
      signedOut: props.entry.connection?.type === "http" && health()?.unauthorized,
    })),
    health: sharedMount(() => (
      <ServerHealthIndicator health={health()} authenticationRequired={!!health()?.unauthorized} />
    )),
    menu: sharedMount(() => (
      <Show when={props.entry.connection}>
        {(server) => <ServerRowMenu server={server()} domain={registry} onEdit={edit} />}
      </Show>
    )),
    contributed: sharedMount(() => <ExtensionServerRow server={props.entry.key} controller={registry} />),
    add: sharedMount(() => <AddServerMenu onAddServer={() => props.onAddServer?.()} />),
    authenticate() {
      const server = props.entry.connection
      if (server?.type === "http") edit(server)
    },
    agents: (view: "harness" | "machines" | "worktrees") =>
      navigate(`/agents?view=${view}&host=${encodeURIComponent(props.entry.key)}`),
    share() {
      const server = props.entry.connection
      if (server) void dialog.push(() => <DialogShareServer server={server} />)
    },
    https() {
      const server = props.entry.connection
      if (server) void dialog.push(() => <DialogHttpsAccess server={server} />)
    },
    voice() {
      const api = context()?.sdk.api
      if (api) void dialog.push(() => <VoiceSettings api={api} />)
    },
    async shells(): Promise<{ shells: ShellOption[]; shell: string }> {
      const api = context()?.sdk.api.config
      if (!api) return { shells: [], shell: "" }
      const [entries, shells] = await Promise.all([api.get().catch(() => []), api.shells().catch(() => [])])
      const boundary = entries.findIndex((entry) => entry.type === "directory")
      return {
        shells,
        shell:
          (boundary === -1 ? entries : entries.slice(0, boundary))
            .flatMap((entry) => (entry.type === "document" && entry.info.shell !== undefined ? [entry.info.shell] : []))
            .at(-1) ?? "",
      }
    },
    async setShell(value: string) {
      await context()?.sdk.api.config.update({ shell: value || null })
    },
    failure: (error: unknown) =>
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : language.t("common.requestFailed"),
      }),
  }
}
export function SettingsServerGeneral(props: {
  entry: SettingsServer
  nested?: boolean
  onAddServer?: () => void
  onServerChange?: (server: ServerConnection.Any) => void
}) {
  const services = createServerGeneralServices(props)
  return <ReactView component={ServerGeneral} props={{ services }} />
}
