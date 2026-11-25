import { ReactView } from "@opencode/ui/react-view"
import { useNativeDialog } from "@opencode/ui/context/dialog"
import { CreatorRequestDialog } from "./request-dialog.react"
import { createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useExtension, type SessionRef } from "../sdk"
import type definition from "./index"

export default function Create(props: { session: SessionRef; close: () => void; started: (kind: string) => void }) {
  const ctx = useExtension<typeof definition>()
  const modal = useNativeDialog()
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
    <ReactView
      component={CreatorRequestDialog}
      props={{
        open: modal.open(),
        title: ctx.t("create.title"),
        description: ctx.t("create.description"),
        submitLabel: ctx.t(state.pending ? "create.pending" : "create.start"),
        creation: {
          kindLabel: ctx.t("create.kind"),
          kind: state.kind,
          setKind: (value) => setState("kind", value),
          search: ctx.t("ui.searchSelect.search"),
          empty: ctx.t("ui.searchSelect.empty"),
          options: [
            { value: "visual", label: ctx.t("studio.visual"), description: ctx.t("create.visual.description") },
            { value: "server", label: ctx.t("studio.plugins"), description: ctx.t("create.server.description") },
          ],
          nameLabel: ctx.t("create.name"),
          name: state.name,
          setName: (value) => setState("name", value),
          scope: ctx.t("create.scope", {
            server: props.session.server.name,
            directory: props.session.location?.directory ?? "",
          }),
          conversation: ctx.t("create.conversation", { model: info()?.model?.id ?? ctx.t("create.model.missing") }),
        },
        requestLabel: ctx.t("create.brief"),
        request: state.brief,
        setRequest: (value) => setState("brief", value),
        disabled: state.pending || busy() || !info()?.model || !state.name.trim() || !state.brief.trim(),
        pending: state.pending,
        busyHint: busy() ? ctx.t("create.busy") : undefined,
        error: state.error,
        closeLabel: ctx.t("ui.common.close"),
        cancelLabel: ctx.t("common.cancel"),
        close: props.close,
        submit,
      }}
    />
  )
}
