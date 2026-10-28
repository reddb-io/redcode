import { useSearchParams } from "@solidjs/router"
import { useQuery } from "@tanstack/solid-query"
import { card } from "@reddb-io/design-system/contracts/card"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { For, lazy, Show, Suspense } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection, serverName } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { DialogShareServer } from "@/servers/connect/share-dialog"
import { DialogHttpsAccess } from "@/servers/connect/https-dialog"
import { DirectoryPickerDialog } from "@/workspaces/selection/dialog"
import { useProjectActions } from "@/home/projects/actions"
import { RemoteWorkers } from "./remote-workers"
import { WorkerInvitation } from "./worker-invitation"

const AgentMachines = lazy(() => import("./agents-machines"))

/** Server connections belong to this client; worker registrations belong to the selected server. */
export default function AgentServers(props: { server: ServerConnection.Any }) {
  const language = useLanguage()
  const platform = usePlatform()
  const global = useGlobal()
  const dialog = useDialog()
  const projects = useProjectActions()
  const [params, setParams] = useSearchParams()
  const connection = () => global.ensureServerCtx(props.server).sdk.connection.status()
  const workers = useQuery(() => ({
    queryKey: ["remote-workers", ServerConnection.key(props.server)],
    queryFn: ({ signal }) => global.ensureServerCtx(props.server).sdk.api.workers.list({ signal }),
    enabled:
      params.setup !== "1" &&
      ["servers", "machines", "remote"].includes(String(params.view)) &&
      connection() === "connected",
    retry: false,
    refetchInterval: 3_000,
  }))
  const appearance = card({ padding: "sm" })
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-4 text-13-regular leading-[var(--line-height-base)]">
      <Show
        when={params.setup === "1"}
        fallback={
          <RemoteWorkers
            server={props.server}
            overview={
              <section aria-label={language.t("infrastructure.topology")} class="flex min-w-0 flex-col gap-3">
                <ol class="grid min-w-0 list-none gap-3 p-0 lg:grid-cols-3">
                  <li class={appearance.root({ class: "min-w-0" })}>
                    <h3 class="text-13-medium">{language.t("infrastructure.client")}</h3>
                    <p>
                      {language.t(
                        platform.platform === "desktop" ? "infrastructure.desktop" : "infrastructure.browser",
                      )}
                    </p>
                    <p class="mt-1 text-ink-muted">{language.t("infrastructure.clientNote")}</p>
                  </li>
                  <li class={appearance.root({ class: "min-w-0" })}>
                    <h3 class="text-13-medium">{language.t("infrastructure.server")}</h3>
                    <p class="break-words font-medium">{serverName(props.server)}</p>
                    <p class="break-all text-mono text-caption text-ink-muted">{props.server.http.url}</p>
                    <p role="status">
                      {language.t(
                        connection() === "connected" ? "infrastructure.connected" : "infrastructure.disconnected",
                      )}
                    </p>
                    <p class="mt-1 text-ink-muted">{language.t("infrastructure.serverNote")}</p>
                    <Show when={props.server.type === "extension" && props.server.extension === "ssh"}>
                      <p class="mt-1 text-ink-muted">{language.t("infrastructure.sshNote")}</p>
                    </Show>
                  </li>
                  <li class={appearance.root({ class: "min-w-0" })}>
                    <h3 class="text-13-medium">{language.t("infrastructure.workers")}</h3>
                    <p class="text-ink-muted">{language.t("infrastructure.workersNote")}</p>
                    <Show when={workers.isPending}>
                      <p role="status">{language.t("remoteWorkers.loading")}</p>
                    </Show>
                    <Show when={workers.isError || workers.data?.available === false}>
                      <p role="status">{language.t("remoteWorkers.unavailable")}</p>
                    </Show>
                    <Show when={workers.data?.available && !workers.data.workers.length}>
                      <p class="mt-1">{language.t("infrastructure.noWorkers")}</p>
                    </Show>
                    <ul class="mt-2 flex list-none flex-col gap-1 p-0">
                      <For each={workers.data?.workers.slice(0, 5)}>
                        {(worker) => (
                          <li class="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 border-t border-muted py-1">
                            <span class="break-words">{worker.worker.id}</span>
                            <span class="text-caption text-ink-muted">
                              {language.t(`remoteWorkers.connection.${worker.connection}`)}
                            </span>
                            <Show when={worker.worker.kind === "local"}>
                              <span class="basis-full text-caption text-ink-muted">
                                {language.t("infrastructure.localWorker")}
                              </span>
                            </Show>
                          </li>
                        )}
                      </For>
                    </ul>
                  </li>
                </ol>
                <div class="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={connection() !== "connected"}
                    onClick={() => {
                      const server = props.server
                      dialog.show(() => (
                        <DirectoryPickerDialog
                          server={server}
                          title={language.t("infrastructure.openProjectTitle", { server: serverName(server) })}
                          onSelect={(directory) => {
                            if (typeof directory === "string") projects.newSession(server, directory)
                          }}
                        />
                      ))
                    }}
                  >
                    {language.t("infrastructure.openProject")}
                  </Button>
                  <Button variant="outline" onClick={() => setParams({ view: "servers", setup: "1" })}>
                    {language.t("infrastructure.connectServer")}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={connection() !== "connected" || !workers.data?.available}
                    onClick={() => dialog.show(() => <WorkerInvitation server={props.server} />)}
                  >
                    {language.t("infrastructure.addWorker")}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={connection() !== "connected"}
                    onClick={() => dialog.show(() => <DialogShareServer server={props.server} />)}
                  >
                    {language.t("infrastructure.openDevice")}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={connection() !== "connected"}
                    onClick={() => dialog.show(() => <DialogHttpsAccess server={props.server} />)}
                  >
                    {language.t("infrastructure.https")}
                  </Button>
                </div>
                <details class="rounded-lg border border-muted px-3">
                  <summary class="cursor-pointer py-2 font-medium">{language.t("infrastructure.connections")}</summary>
                  <dl class="mb-3 grid gap-3 sm:grid-cols-3">
                    <div>
                      <dt class="font-medium">{language.t("infrastructure.localTitle")}</dt>
                      <dd class="m-0 mt-1 text-ink-muted">{language.t("infrastructure.localNote")}</dd>
                    </div>
                    <div>
                      <dt class="font-medium">{language.t("infrastructure.remoteTitle")}</dt>
                      <dd class="m-0 mt-1 text-ink-muted">{language.t("infrastructure.remoteNote")}</dd>
                    </div>
                    <div>
                      <dt class="font-medium">{language.t("infrastructure.webTitle")}</dt>
                      <dd class="m-0 mt-1 text-ink-muted">{language.t("infrastructure.webNote")}</dd>
                    </div>
                  </dl>
                  <p class="mb-3 text-ink-muted">{language.t("infrastructure.ownership")}</p>
                  <p class="mb-3 text-ink-muted">{language.t("infrastructure.sessionScope")}</p>
                  <p class="mb-3 text-ink-muted">{language.t("infrastructure.coordinatorNote")}</p>
                  <p class="mb-3 text-ink-muted">{language.t("infrastructure.networkNote")}</p>
                </details>
              </section>
            }
          />
        }
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-13-medium">{language.t("infrastructure.connectServer")}</h3>
          <Button variant="outline" onClick={() => setParams({ setup: undefined })}>
            {language.t("infrastructure.back")}
          </Button>
        </div>
        <Suspense fallback={<p role="status">{language.t("agents.loading")}</p>}>
          <AgentMachines server={props.server} />
        </Suspense>
      </Show>
    </div>
  )
}
