import { createStore } from "solid-js/store"
import type { FormAnswer, FormInfo } from "@opencode/client/promise"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { ScopedKey } from "@/runtime/server/scope"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { sharedLanguage } from "@/runtime/react/language"
import { sharedSource } from "@/runtime/react/source"
import { ReactView } from "@/runtime/react/view"
import { SessionMcpDockView } from "./session-mcp-dock.react"

const drafts = new Map<string, FormAnswer>()

export function createSessionMcpServices(props: { request: FormInfo; onSubmit: () => void }) {
  const data = useData()
  const sdk = useServerSDK()
  const key = ScopedKey.from(sdk.scope, props.request.id)
  const language = useLanguage()
  const platform = usePlatform()
  const [state, setState] = createStore({ sending: false, failed: false })
  const server = typeof props.request.metadata?.server === "string" ? props.request.metadata.server : undefined
  const message = typeof props.request.metadata?.message === "string" ? props.request.metadata.message : undefined
  const settle = async (operation: () => Promise<unknown>) => {
    if (state.sending) return
    setState({ sending: true, failed: false })
    props.onSubmit()
    await operation()
      .then(() => drafts.delete(key))
      .catch(() => setState("failed", true))
      .finally(() => setState("sending", false))
  }
  return {
    snapshot: sharedSource(() => ({
      language: sharedLanguage(language),
      title: server ? language.t("session.mcp.title", { server }) : props.request.title,
      message,
      fields: props.request.fields,
      draft: drafts.get(key),
      sending: state.sending,
      failed: state.failed,
    })),
    save: (answer: FormAnswer) => drafts.set(key, answer),
    reply: (answer: FormAnswer) =>
      settle(() => data.session.form.reply({ sessionID: props.request.sessionID, formID: props.request.id, answer })),
    cancel: () =>
      settle(() => data.session.form.cancel({ sessionID: props.request.sessionID, formID: props.request.id })),
    open: (url: string) => {
      // The form metadata is remote input, even when the active platform can open local application URLs.
      if (!/^https?:\/\//i.test(url)) return
      platform.openExternal(url)
    },
  }
}

export function SessionMcpDock(props: Parameters<typeof createSessionMcpServices>[0]) {
  const services = createSessionMcpServices(props)
  return <ReactView component={SessionMcpDockView} props={{ services }} />
}
