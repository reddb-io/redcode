import { lazy, onCleanup, Suspense } from "solid-js"
import { Command, MenuItem, onIdle, type Setup } from "../sdk"
import type definition from "./index"

const setup: Setup<typeof definition> = (ctx) => {
  const ImportDialog = lazy(() => import("./dialog"))
  onCleanup(onIdle(() => void ImportDialog.preload()))
  const sessions = ctx.sessions
  const servers = ctx.servers

  // `directory` scopes the list to one folder first; without one the dialog lists every folder.
  const open = (server: string, directory: string | undefined) =>
    ctx.dialogs.open(
      (dialog) => (
        <Suspense>
          <ImportDialog ctx={ctx} server={server} directory={directory} close={() => dialog.close()} />
        </Suspense>
      ),
      { replace: true },
    )

  // The routed session's server and folder; elsewhere the app's own server, else the first listed, in every folder.
  const target = () => {
    const session = sessions.current()

    if (session) return { server: session.server.id, directory: session.directory }
    const listed = servers.list().flatMap((id) => servers.get(id) ?? [])
    const server = listed.find((item) => item.builtin) ?? listed[0]

    return server ? { server: server.id, directory: undefined } : undefined
  }

  ctx.add(
    Command,
    (): Command => ({
      id: "open",
      title: ctx.t("command.title"),
      description: ctx.t("command.description"),
      group: ctx.t("command.category.session"),
      section: "session",
      slash: { name: "import" },
      // Offered once a server is listed to import into.
      enabled: !!target(),
      run: () => {
        const value = target()

        if (value) open(value.server, value.directory)
      },
    }),
  )

  ctx.add(
    MenuItem,
    (): MenuItem => ({
      id: "project",
      menu: "project",
      title: ctx.t("menu.title"),
      run: (server, directory) => open(server, directory),
    }),
  )
}

export default setup
