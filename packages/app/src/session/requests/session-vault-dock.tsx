import { createSignal, onMount } from "solid-js"
import { Vault } from "@opencode/schema/vault"
import { Button } from "@opencode/ui/button"
import { DockShell, DockTray } from "@opencode/ui/dock-surface"
import { TextInput } from "@opencode/ui/text-input"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { showToast } from "@/shell/notifications/toast"
import type { SessionVaultRequest } from "./model"
import "./session-vault-dock.css"

/**
 * Asks the user for the secret a `vault_request` form names. The value is read from the masked input only when it is
 * stored and never kept in reactive state, so nothing renders, logs or caches it.
 */
export function SessionVaultDock(props: { request: SessionVaultRequest; onSubmit: () => void }) {
  const language = useLanguage()
  const data = useData()
  const [sending, setSending] = createSignal(false)
  let input: HTMLInputElement | undefined

  onMount(() => input?.focus())

  const title = () =>
    language.t("session.vault.request.title", { reference: Vault.reference(props.request.secret.name) })

  const settle = (request: Promise<unknown>) => {
    setSending(true)
    props.onSubmit()
    // The failure description is fixed on purpose: a server error must never be able to carry the value to a toast.
    void request
      .catch(() =>
        showToast({ title: language.t("common.requestFailed"), description: language.t("session.vault.failed") }),
      )
      .finally(() => setSending(false))
  }

  const store = (event: SubmitEvent) => {
    event.preventDefault()
    if (sending() || !input) return
    const value = input.value
    if (!value) {
      input.focus()
      return
    }
    input.value = ""
    settle(
      data.session.form.reply({
        sessionID: props.request.form.sessionID,
        formID: props.request.form.id,
        answer: { [Vault.FORM_FIELD]: value },
      }),
    )
  }

  const decline = () => {
    if (sending()) return
    if (input) input.value = ""
    settle(data.session.form.cancel({ sessionID: props.request.form.sessionID, formID: props.request.form.id }))
  }

  return (
    <form
      data-component="session-vault-dock"
      aria-label={title()}
      aria-busy={sending()}
      onSubmit={store}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return
        event.preventDefault()
        decline()
      }}
    >
      <DockShell class="vault-body">
        <div class="vault-title">{title()}</div>
        <div class="vault-purpose">{props.request.secret.purpose}</div>
        <TextInput
          ref={(el) => (input = el)}
          type="password"
          name="vault-value"
          autocomplete="off"
          appearance="large"
          disabled={sending()}
          aria-label={language.t("session.vault.request.value", { name: props.request.secret.name })}
          placeholder={language.t("session.vault.request.placeholder")}
        />
        <div class="vault-hint">{language.t("session.vault.request.hint")}</div>
      </DockShell>
      <DockTray attach="top" class="vault-footer">
        <Button
          type="button"
          variant="ghost"
          size="small"
          disabled={sending()}
          onClick={decline}
          aria-keyshortcuts="Escape"
        >
          {language.t("session.vault.request.decline")}
        </Button>
        <Button type="submit" variant="submit" size="small" disabled={sending()}>
          {language.t("session.vault.request.store")}
        </Button>
      </DockTray>
    </form>
  )
}
