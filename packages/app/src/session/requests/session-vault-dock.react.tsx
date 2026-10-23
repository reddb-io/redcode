/** @jsxImportSource react */
import { useRef, useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Input } from "@reddb-io/design-system/base/Input"
import type { createSessionVaultServices } from "./session-vault-dock"

/** The secret stays in the masked DOM input and is cleared before crossing the service boundary. */
export function SessionVaultDockView(props: { services: ReturnType<typeof createSessionVaultServices> }) {
  const services = props.services
  const view = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const language = view.language
  const input = useRef<HTMLInputElement>(null)
  const decline = () => {
    if (input.current) input.current.value = ""
    services.decline()
  }
  return (
    <form
      data-component="session-vault-dock"
      aria-label={view.title}
      aria-busy={view.sending}
      onSubmit={(event) => {
        event.preventDefault()
        if (view.sending || !input.current) return
        const value = input.current.value
        if (!value) {
          input.current.focus()
          return
        }
        input.current.value = ""
        services.store(value)
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return
        event.preventDefault()
        decline()
      }}
    >
      <div data-dock-surface="shell" className="vault-body">
        <div className="vault-title">{view.title}</div>
        <div className="vault-purpose">{view.purpose}</div>
        <Input
          ref={input}
          type="password"
          name="vault-value"
          autoComplete="off"
          autoFocus
          controlSize="lg"
          disabled={view.sending}
          aria-label={language.t("session.vault.request.value", { name: view.name })}
          placeholder={language.t("session.vault.request.placeholder")}
        />
        <div className="vault-hint">{language.t("session.vault.request.hint")}</div>
      </div>
      <div data-dock-surface="tray" data-dock-attach="top" className="vault-footer">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={view.sending}
          onClick={decline}
          aria-keyshortcuts="Escape"
        >
          {language.t("session.vault.request.decline")}
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={view.sending}>
          {language.t("session.vault.request.store")}
        </Button>
      </div>
    </form>
  )
}
