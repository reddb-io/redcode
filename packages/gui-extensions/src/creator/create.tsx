import { createMemo, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { SearchSelect } from "@opencode/ui/search-select"
import { TextField } from "@opencode/ui/text-field"
import { useExtension, type SessionRef } from "../sdk"
import type definition from "./index"

export default function Create(props: { session: SessionRef; close: () => void; started: (kind: string) => void }) {
  const ctx = useExtension<typeof definition>()
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  const [state, setState] = createStore({ kind: "visual", name: "", brief: "", pending: false, error: "" })
  const info = createMemo(() => props.session.server.data.session.get(props.session.id))
  const busy = () => props.session.server.data.session.status(props.session.id) !== "idle"
  const submit = async () => {
    if (state.pending || busy() || !state.name.trim() || !state.brief.trim()) return
    if (!info()?.model) {
      setState("error", ctx.t("create.model.required"))
      return
    }
    setState({ pending: true, error: "" })
    const kind = state.kind
    const text = [
      "Create an installable Redcode extension in this conversation. Load the Creator skill and use its artifact/document tools. Keep source inside the returned document work root.",
      kind === "visual"
        ? "Deliver an isolated interactive visual component. Define a Creator artifact contract with artifact interactive-tool and outputs preview/component/files. Reuse the configured project design system. Use portable HTML when the brief permits and project framework dependencies are unavailable. Build and publish through design_preview; the user must not need shell commands or manually copied bundles. Include meaningful controls, loading/error states and accessible labels."
        : "Deliver a real server-plugin extension with package.json and bundled server.js at the document work root. Define the server-plugin contract with its actual entry, capabilities and outputs package/source/instructions. Use the Redcode plugin SDK, schema-defined tools and explicit permission boundaries. Avoid unnecessary dependencies; never embed credentials. Include usage and verification instructions.",
      "Publish a revision when ready, but do not install or activate it. The user will preview/test and confirm installation in the Creator interface. Report build errors concretely; never claim runtime tests passed merely because files were generated.",
      `Extension name: ${state.name.trim()}`,
      `User requirements:\n${state.brief.trim()}`,
    ].join("\n\n")
    try {
      await props.session.server.client.session.switchAgent(
        { sessionID: props.session.id, agent: "creator" },
        { signal: controller.signal },
      )
      if (controller.signal.aborted) return
      await props.session.server.data.session.prompt({ sessionID: props.session.id, text })
      if (controller.signal.aborted) return
      props.started(kind)
      props.close()
    } catch (error) {
      if (!controller.signal.aborted)
        setState("error", error instanceof Error ? error.message : ctx.t("request.failed"))
    } finally {
      if (!controller.signal.aborted) setState("pending", false)
    }
  }
  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup title={ctx.t("create.title")} description={ctx.t("create.description")} />
      </DialogHeader>
      <div class="space-y-3 px-6 pb-4">
        <SearchSelect
          label={ctx.t("create.kind")}
          value={state.kind}
          onChange={(value) => setState("kind", value)}
          disabled={state.pending}
          options={[
            { value: "visual", label: ctx.t("studio.visual"), description: ctx.t("create.visual.description") },
            { value: "server", label: ctx.t("studio.plugins"), description: ctx.t("create.server.description") },
          ]}
        />
        <TextField
          label={ctx.t("create.name")}
          value={state.name}
          onChange={(value) => setState("name", value)}
          disabled={state.pending}
        />
        <TextField
          label={ctx.t("create.brief")}
          multiline
          rows={4}
          value={state.brief}
          onChange={(value) => setState("brief", value)}
          disabled={state.pending}
        />
        <p class="break-words text-12-regular text-ink-muted">
          {ctx.t("create.scope", {
            server: props.session.server.name,
            directory: props.session.location?.directory ?? "",
          })}
        </p>
        <p class="text-12-regular text-ink-muted">
          {ctx.t("create.conversation", { model: info()?.model?.id ?? ctx.t("create.model.missing") })}
        </p>
        <Show when={busy()}>
          <p role="status" class="text-12-regular text-ink-muted">
            {ctx.t("create.busy")}
          </p>
        </Show>
        <Show when={state.error}>
          <p role="alert" class="break-words text-12-regular text-text-danger-base">
            {state.error}
          </p>
        </Show>
      </div>
      <DialogFooter>
        <Button variant="ghost" disabled={state.pending} onClick={props.close}>
          {ctx.t("common.cancel")}
        </Button>
        <Button
          variant="submit"
          disabled={state.pending || busy() || !info()?.model || !state.name.trim() || !state.brief.trim()}
          onClick={() => void submit()}
        >
          {ctx.t(state.pending ? "create.pending" : "create.start")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
