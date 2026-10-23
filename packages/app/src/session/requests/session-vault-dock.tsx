import { createStore } from "solid-js/store"
import { Vault } from "@opencode/schema/vault"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { sharedLanguage } from "@/runtime/react/language"
import { sharedSource } from "@/runtime/react/source"
import { ReactView } from "@/runtime/react/view"
import { showToast } from "@/shell/notifications/toast"
import type { SessionVaultRequest } from "./model"
import { SessionVaultDockView } from "./session-vault-dock.react"
import "./session-vault-dock.css"

export function createSessionVaultServices(props: { request: SessionVaultRequest; onSubmit: () => void }) {
  const language = useLanguage()
  const data = useData()
  const [state, setState] = createStore({ sending: false })
  const settle = (request: Promise<unknown>) => {
    setState("sending", true)
    props.onSubmit()
    // Server errors must never carry a submitted secret into notifications.
    void request
      .catch(() =>
        showToast({ title: language.t("common.requestFailed"), description: language.t("session.vault.failed") }),
      )
      .finally(() => setState("sending", false))
  }
  return {
    snapshot: sharedSource(() => ({
      language: sharedLanguage(language),
      title: language.t("session.vault.request.title", { reference: Vault.reference(props.request.secret.name) }),
      name: props.request.secret.name,
      purpose: props.request.secret.purpose,
      sending: state.sending,
    })),
    store: (value: string) => {
      if (state.sending) return
      settle(
        data.session.form.reply({
          sessionID: props.request.form.sessionID,
          formID: props.request.form.id,
          answer: { [Vault.FORM_FIELD]: value },
        }),
      )
    },
    decline: () => {
      if (state.sending) return
      settle(data.session.form.cancel({ sessionID: props.request.form.sessionID, formID: props.request.form.id }))
    },
  }
}

export function SessionVaultDock(props: Parameters<typeof createSessionVaultServices>[0]) {
  const services = createSessionVaultServices(props)
  return <ReactView component={SessionVaultDockView} props={{ services }} />
}
