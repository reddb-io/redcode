import { ServerConnection, useCurrentRoute, useGlobal, useLanguage, useServers, useTabs } from "@opencode/app/desktop"
import { showToast } from "@opencode/ui/toast"
import { createResource } from "solid-js"
import type { ElectronAPI } from "../api-types"

export function DesktopFirstLaunchOnboarding(props: {
  api: ElectronAPI
  initialUrl: string
  pending: boolean
  onReady: () => void
}) {
  const server = useServers()
  const global = useGlobal()
  const tabs = useTabs()
  const route = useCurrentRoute()
  const language = useLanguage()

  const [completed] = createResource(async () => {
    await runFirstLaunchOnboarding()

    return null
  })

  async function runFirstLaunchOnboarding() {
    try {
      if (!props.pending) return

      await Promise.all([tabs.ready.promise, tabs.recentReady.promise].map((p) => p ?? Promise.resolve()))

      const shouldOffer =
        props.initialUrl === "/" &&
        route().type === "home" &&
        tabs.store.length === 0 &&
        server.list.every(ServerConnection.builtin)

      console.info("[desktop-onboarding] first launch onboarding evaluated", {
        pending: props.pending,
        shouldOffer,
        initialUrl: props.initialUrl,
        tabs: tabs.store.length,
        servers: server.list.map(ServerConnection.key),
      })

      if (!shouldOffer) {
        await props.api.finishFirstLaunchOnboarding(false)

        return
      }

      // The default project is opt-in: nothing touches the user's Documents until they accept. Closing the toast
      // without an answer leaves onboarding pending, so the next fresh start offers it again.
      showToast({
        title: language.t("home.defaultProject.title"),
        description: language.t("home.defaultProject.description", {
          name: language.t("desktop.onboarding.defaultProject"),
        }),
        persistent: true,
        actions: [
          {
            label: language.t("home.defaultProject.create"),
            onClick: () =>
              void createDefaultProject().catch((error) => {
                console.error("[desktop-onboarding] default project failed", error)
                showToast({ variant: "error", title: language.t("common.requestFailed"), description: String(error) })
              }),
          },
          {
            label: language.t("home.defaultProject.decline"),
            variant: "secondary",
            onClick: () => void props.api.finishFirstLaunchOnboarding(false),
          },
        ],
      })
    } finally {
      props.onReady()
    }
  }

  async function createDefaultProject() {
    const directory = await props.api.finishFirstLaunchOnboarding(true)

    if (!directory) return

    console.info("[desktop-onboarding] starting first launch draft", { directory })
    const sidecar = ServerConnection.Key.make("sidecar")
    const projects = server.projects.forServer(sidecar)
    projects.open(directory)
    projects.touch(directory)
    const connection = server.list.find((connection) => ServerConnection.key(connection) === sidecar)

    if (connection) {
      const data = global.ensureServerCtx(connection).data
      // Load the initial provider/model state before the draft transition exposes the composer.
      await Promise.all([data.location.provider.sync({ directory }), data.location.model.sync({ directory })])
    }

    tabs.select(await tabs.newDraft({ server: sidecar, directory }))
  }

  // Let startup failures reach the app's recovery screen, including its splash boundary.
  return <>{completed()}</>
}
