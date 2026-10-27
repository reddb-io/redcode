import { useQuery } from "@tanstack/solid-query"
import { input } from "@reddb-io/design-system/contracts/input"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { useDialog } from "@opencode/ui/context/dialog"
import type { Worker } from "@opencode/schema/worker"
import { createMemo, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { errorMessage } from "@/shell/layout/helpers"

export function WorkerInvitation(props: { server: ServerConnection.Any }) {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const global = useGlobal()
  const api = global.ensureServerCtx(props.server).sdk.api
  const [state, setState] = createStore({
    id: "",
    tags: "",
    address: undefined as string | undefined,
    busy: false,
    error: "",
    copied: false,
    invitation: undefined as Worker.Invitation | undefined,
    now: Date.now(),
  })
  const lifetime = { active: true }
  const timer = setInterval(() => setState("now", Date.now()), 1_000)
  onCleanup(() => {
    lifetime.active = false
    clearInterval(timer)
  })
  const info = useQuery(() => ({
    queryKey: ["worker-invitation-addresses", ServerConnection.key(props.server)],
    queryFn: ({ signal }) => api.server.info({ signal }),
    retry: false,
  }))
  const reachable = (value: string) => {
    const url = URL.parse(value)
    return url &&
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/" &&
      /^[a-zA-Z0-9.:[\]%-]+$/.test(url.hostname) &&
      !["localhost", "127.0.0.1", "[::1]", "0.0.0.0", "[::]"].includes(url.hostname)
      ? url.origin
      : undefined
  }
  const address = () =>
    state.address ?? info.data?.urls.find((url) => reachable(url)) ?? reachable(props.server.http.url) ?? ""
  const expired = createMemo(() => !!state.invitation && state.now >= state.invitation.expiresAt)
  const workers = useQuery(() => ({
    queryKey: ["worker-invitation-status", ServerConnection.key(props.server), state.invitation?.id],
    queryFn: ({ signal }) => api.workers.list({ signal }),
    enabled: !!state.invitation && !expired(),
    retry: false,
    refetchInterval: 3_000,
  }))
  const enrolled = () => workers.data?.workers.some((item) => item.worker.id === state.invitation?.id)
  const link = () => (state.invitation ? `${reachable(address())}/auth/worker#${state.invitation.code}` : "")
  const command = () => `redcode workers join '${link()}'`
  const action = async (run: () => Promise<unknown>) => {
    if (state.busy) return
    setState({ busy: true, error: "", copied: false })
    try {
      await run()
    } catch (error) {
      if (lifetime.active) setState("error", errorMessage(error, language.t("common.requestFailed")))
    } finally {
      if (lifetime.active) setState("busy", false)
    }
  }
  const copy = (value: string) =>
    void action(async () => {
      await (platform.writeClipboardText?.(value) ?? navigator.clipboard.writeText(value))
      if (lifetime.active) setState("copied", true)
    })
  return (
    <Dialog fit class="max-w-xl">
      <DialogHeader>
        <DialogTitle>{language.t("workerInvitation.title")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="flex flex-col gap-3 px-4 text-13-regular leading-[var(--line-height-base)]">
        <p class="text-ink-muted">{language.t("workerInvitation.description")}</p>
        <form
          id="worker-invitation"
          class="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!reachable(address())) return
            void action(async () => {
              const invitation = await api.workers.invite({
                id: state.id.trim(),
                tags: state.tags
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              })
              if (lifetime.active) setState({ invitation, address: reachable(address())!, now: Date.now() })
            })
          }}
        >
          <label class="flex flex-col gap-1">
            {language.t("agentMachines.workerID")}
            <input
              required
              pattern="[a-zA-Z0-9_-]+"
              class={input({ size: "sm" })}
              value={state.id}
              disabled={state.busy || !!state.invitation}
              onInput={(event) => setState("id", event.currentTarget.value)}
            />
          </label>
          <label class="flex flex-col gap-1">
            {language.t("workerInvitation.address")}
            <input
              required
              type="url"
              class={input({ size: "sm" })}
              value={address()}
              placeholder="https://redcode.example.com"
              disabled={state.busy || !!state.invitation}
              onInput={(event) => setState("address", event.currentTarget.value)}
            />
          </label>
          <p class="text-ink-muted">{language.t("workerInvitation.network")}</p>
          <label class="flex flex-col gap-1">
            {language.t("agentMachines.tags")}
            <input
              class={input({ size: "sm" })}
              value={state.tags}
              disabled={state.busy || !!state.invitation}
              onInput={(event) => setState("tags", event.currentTarget.value)}
            />
          </label>
        </form>
        <Show when={state.invitation}>
          {(invitation) => (
            <>
              <p role="status">
                {language.t(
                  enrolled()
                    ? "workerInvitation.enrolled"
                    : expired()
                      ? "workerInvitation.expired"
                      : "workerInvitation.waiting",
                )}
              </p>
              <Show when={!enrolled() && !expired()}>
                <p class="text-ink-muted">
                  {language.t("workerInvitation.expires", {
                    time: new Date(invitation().expiresAt).toLocaleTimeString(),
                  })}
                </p>
                <pre class="select-text whitespace-pre-wrap break-all rounded-md border border-muted p-3 text-mono">
                  {command()}
                </pre>
                <div class="flex flex-wrap gap-2">
                  <Button variant="outline" disabled={state.busy} onClick={() => copy(command())}>
                    {language.t("workerInvitation.copyCommand")}
                  </Button>
                  <Button variant="outline" disabled={state.busy} onClick={() => copy(link())}>
                    {language.t("workerInvitation.copyLink")}
                  </Button>
                </div>
                <p class="text-ink-muted">{language.t("workerInvitation.workerSetup")}</p>
              </Show>
              <Show when={workers.isError && !expired()}>
                <p role="status">{language.t("workerInvitation.syncFailed")}</p>
              </Show>
              <Show when={!enrolled()}>
                <Button
                  variant="outline"
                  disabled={state.busy}
                  onClick={() =>
                    void action(async () => {
                      await api.workers.revokeInvitation({ code: invitation().code })
                      if (lifetime.active) setState("invitation", undefined)
                    })
                  }
                >
                  {language.t("workerInvitation.revoke")}
                </Button>
              </Show>
            </>
          )}
        </Show>
        <Show when={state.copied}>
          <p role="status">{language.t("workerInvitation.copied")}</p>
        </Show>
        <Show when={state.error}>
          <p role="alert" class="break-words">
            {state.error}
          </p>
        </Show>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" aria-label={language.t("workerInvitation.close")} onClick={() => dialog.close()}>
          {language.t("common.close")}
        </Button>
        <Show when={!state.invitation}>
          <Button
            variant="submit"
            type="submit"
            form="worker-invitation"
            disabled={state.busy || !state.id.trim() || !reachable(address())}
          >
            {language.t("workerInvitation.create")}
          </Button>
        </Show>
      </DialogFooter>
    </Dialog>
  )
}
