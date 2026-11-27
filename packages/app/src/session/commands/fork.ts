import { useData, useServer } from "@/runtime/server/current"
import { createTabComposerState } from "@/composer/persistence"
import { showToast } from "@/shell/notifications/toast"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { base64Encode } from "@opencode/util/encode"
import { extractPromptContext, extractPromptFromMessage } from "@/composer/prompt"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useTabs } from "@/shell/tabs/tabs"

/** Fork the complete session or branch before a prompt, restoring that prompt as a draft. */
export function useForkFromMessage() {
  const data = useData()
  const serverSDK = useServerSDK()
  const location = useWorkspaceLocation()
  const language = useLanguage()
  const server = useServer()
  const tabs = useTabs()

  return async (sessionID: string, messageID?: string, onForked?: () => void) => {
    const message = messageID ? data.session.message.get(sessionID, messageID) : undefined
    if (messageID && message?.type !== "user") return
    const restored =
      message?.type === "user"
        ? extractPromptFromMessage(message, {
            directory: location().directory,
            attachmentName: language.t("common.attachment"),
          })
        : undefined
    const context =
      message?.type === "user" ? extractPromptContext(message, { directory: location().directory }) : undefined
    const dir = base64Encode(location().directory)

    await serverSDK.api.session
      .fork({ sessionID, before: messageID })
      .then(async (forked) => {
        data.session.remember(forked)
        const tab = tabs.addSessionTab({ server: server.key, sessionId: forked.id })
        if (restored && context) {
          const target = createTabComposerState(tabs, tab, serverSDK.scope, { dir, id: forked.id })
          await target.ready.promise
          target.set(restored)
          target.context.replace([...context.comments, ...context.files])
        }
        tabs.select(tab)
        onForked?.()
      })
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }
}
