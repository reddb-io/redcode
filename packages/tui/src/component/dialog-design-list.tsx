import { createResource, createSignal, onCleanup } from "solid-js"
import type { Plugin } from "@opencode/plugin/tui"
import { Schema } from "effect"
import { designBrowser, openUrl } from "@opencode/util/open"
import { useClient } from "../context/client"
import { useTheme } from "../context/theme"
import { DialogSelect } from "../ui/dialog-select"
import { configuredDesignBrowser } from "../util/design-browser"
import { errorMessage } from "../util/error"

export function DialogDesignList(props: { context: Plugin.Context; review?: boolean }) {
  const theme = useTheme().surface("dialog")
  const client = useClient()
  const abort = new AbortController()
  const [error, setError] = createSignal("")
  onCleanup(() => abort.abort())
  const [conversations] = createResource(async () => {
    if (props.review) {
      const route = props.context.ui.router.current()
      if (route.type !== "session") return []
      const designs = await props.context.client.session.design.list(
        { sessionID: route.sessionID },
        { signal: abort.signal },
      )
      return [{ sessionID: route.sessionID, title: "Current conversation", designs }]
    }
    return props.context.client.session.design.conversations(
      {
        directory: (props.context.location ?? props.context.data.location.default()).directory,
      },
      { signal: abort.signal },
    )
  })
  // The resource error remains visible instead of being rendered as an empty catalog.
  const options = () =>
    conversations.error
      ? []
      : (conversations() ?? []).map((conversation) => ({
          value: conversation.sessionID,
          title: conversation.designs.map((design) => design.name).join(" · ") || conversation.title,
          description: conversation.title,
          footer: !conversation.designs.length
            ? "Not started"
            : conversation.designs.every((design) => design.ended)
              ? "Closed"
              : conversation.designs.every((design) => design.revision && design.approvedRevision === design.revision)
                ? "Approved"
                : conversation.designs.some((design) => design.revision)
                  ? "In review"
                  : "Draft",
        }))
  return (
    <DialogSelect
      title={props.review ? "Open Design review" : "Resume Design conversation"}
      options={options()}
      emptyView={
        <text fg={conversations.error || error() ? theme.text.feedback.error.base : theme.text.muted}>
          {error() ||
            (conversations.error
              ? errorMessage(conversations.error)
              : conversations.loading
                ? "Loading Design conversations…"
                : "No designs yet. Use /design to start one.")}
        </text>
      }
      footer={
        <text fg={theme.text.muted}>
          {error() || "Use /design-review in a conversation to open its browser preview."}
        </text>
      }
      onSelect={(option) => {
        if (!props.review) {
          props.context.ui.router.navigate({ type: "session", sessionID: option.value })
          props.context.ui.dialog.clear()
          return
        }
        const endpoint = client.endpoint
        if (!endpoint) return setError("Design review requires a server connection")
        void fetch(new URL(`/design/session/${encodeURIComponent(option.value)}/link`, endpoint.url), {
          headers: endpoint.headers,
          signal: abort.signal,
        })
          .then(async (response) => {
            if (!response.ok) throw new Error(`Unable to open Design review: HTTP ${response.status}`)
            const link = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }))(await response.json())
            const config = await props.context.client.config
              .get({ location: props.context.location ?? props.context.data.location.default() })
              .catch(() => [])
            await openUrl(link.url, { browser: designBrowser(configuredDesignBrowser(config)) })
            props.context.ui.dialog.clear()
          })
          .catch((error) => {
            // The footer keeps the link visible when REDCODE_NO_BROWSER refuses the launch.
            if (!abort.signal.aborted) setError(errorMessage(error))
          })
      }}
    />
  )
}
