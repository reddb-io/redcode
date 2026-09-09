import { createMemo, createResource, createSignal, onCleanup } from "solid-js"
import { Schema } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useRoute } from "../context/route"
import { useTheme } from "../context/theme"
import { errorMessage } from "../util/error"

export function DialogDesignList() {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const route = useRoute()
  const theme = useTheme()
  const [error, setError] = createSignal<unknown>()
  const [search, setSearch] = createSignal("")
  const abort = new AbortController()
  onCleanup(() => abort.abort())
  dialog.setSize("large")

  const [conversations] = createResource(async () => {
    const url = new URL("/design/list", sdk.url)
    url.searchParams.set("directory", sync.path.directory)
    return sdk
      .fetch(url, { headers: sdk.headers, signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load Design conversations (${response.status})`)
        return Schema.decodeUnknownSync(Schema.Array(Design.Conversation))(await response.json())
      })
      .catch((error) => {
        if (!abort.signal.aborted) setError(error)
        return []
      })
  })

  const options = createMemo(() =>
    (conversations() ?? [])
      .filter((conversation) =>
        [conversation.title, ...conversation.designs.map((design) => design.name)].some((text) =>
          text.toLowerCase().includes(search().trim().toLowerCase()),
        ),
      )
      .map((conversation) => ({
        title: conversation.designs.map((design) => design.name).join(" · ") || conversation.title,
        description: conversation.designs.length ? conversation.title : undefined,
        value: conversation.sessionID,
        footer: !conversation.designs.length
          ? "Not started"
          : conversation.designs.every((design) => design.ended)
            ? "Closed"
            : conversation.designs.every((design) => design.revision && design.approvedRevision === design.revision)
              ? "Approved"
              : conversation.designs.some((design) => design.revision)
                ? "In review"
                : "Draft",
      })),
  )

  return (
    <DialogSelect
      title="Resume Design"
      placeholder="Search designs or conversations"
      options={options()}
      skipFilter
      onFilter={setSearch}
      current={route.data.type === "session" ? route.data.sessionID : undefined}
      emptyView={
        <box paddingLeft={4} paddingRight={4}>
          <text fg={error() ? theme.theme.error : theme.theme.textMuted}>
            {conversations.loading
              ? "Loading Design conversations…"
              : error()
                ? errorMessage(error())
                : !conversations()?.length
                  ? "No designs in this workspace. Use /design and describe what you want to explore."
                  : "No matching designs."}
          </text>
        </box>
      }
      footer={
        <text fg={theme.theme.textMuted}>Resume the conversation. Use /design-review there to open its preview.</text>
      }
      onSelect={(option) => {
        route.navigate({ type: "session", sessionID: option.value })
        dialog.clear()
      }}
    />
  )
}
