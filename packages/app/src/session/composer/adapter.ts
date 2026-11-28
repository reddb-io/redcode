import type { Accessor } from "solid-js"
import type { ActiveComposerAdapter, ComposerControls } from "@/composer/adapter"
import { useComposerState } from "@/composer/persistence"
import { createComposerReasoning } from "@/composer/reasoning/state"
import { useData, useServer } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"
import { unansweredPrompt } from "@opencode/client/promise"
import { extractPromptContext, extractPromptFromMessage } from "@/composer/prompt"
import { isAttachment, promptLength } from "@/composer/prompt-parts"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"

export function createActiveComposerAdapter(input: {
  sessionID: string
  controls: Accessor<ComposerControls>
  submitted: () => void
  setEditor: (element: HTMLDivElement) => void
}) {
  const id = input.sessionID

  const prompt = useComposerState()
  prompt.current()
  const state = prompt.capture()
  const data = useData()
  const server = useServerSDK()
  const currentServer = useServer()
  const location = useWorkspaceLocation()
  const language = useLanguage()
  const empty = () =>
    !state.context.items().length && !state.current().some((part) => isAttachment(part) || part.content.trim())

  const adapter: ActiveComposerAdapter = {
    kind: "active-session",
    state,
    ready: prompt.ready,
    controls: input.controls,
    reasoning: createComposerReasoning({ session: () => id }),
    working: () => data.session.status(id) === "running",
    submitted: input.submitted,
    setEditor: input.setEditor,
    session: () => ({
      id,
      directory: location().directory,
      handoff: currentServer.ctx.handoff.forSession(id),
      api: server.api.session,
      file: server.api.file,
      data,
      current: () => data.session.get(id),
      admitted: (messageID) => data.session.input.has(id, messageID) || !!data.session.message.get(id, messageID),
    }),
    interrupt: async (options) => {
      const candidate = options?.takeBack && empty() && data.session.pending.list(id).length === 0
        ? unansweredPrompt(data.session.message.list(id))
        : undefined
      const stop = await server.api.session.interrupt({ sessionID: id, resume: true }).catch(() => undefined)
      if (!stop?.interrupted || !candidate) return
      const dir = location().directory
      try {
        await server.api.session.wait({ sessionID: id })
        const page = await server.api.message.list({ sessionID: id, limit: 20, order: "desc" })
        const message = unansweredPrompt(page.data.toReversed())
        if (message?.id !== candidate.id || !empty() || data.session.pending.list(id).length > 0) return
        await server.api.session.revert.stage({ sessionID: id, messageID: message.id, files: false })
        if (!empty()) {
          await server.api.session.revert.clear({ sessionID: id })
          return
        }
        const restored = extractPromptFromMessage(message, { directory: dir, attachmentName: language.t("common.attachment") })
        const context = extractPromptContext(message, { directory: dir })
        state.set(restored, promptLength(restored))
        state.context.replace([...context.comments, ...context.files])
      } catch (error) {
        showToast({ title: language.t("common.requestFailed"), description: error instanceof Error ? error.message : String(error) })
      }
    },
  }

  return adapter
}
