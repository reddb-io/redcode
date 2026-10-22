/** @jsxImportSource react */
import { lazy, Suspense, useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Input } from "@reddb-io/design-system/base/Input"
import { Logo } from "@reddb-io/design-system/base/Logo"
import type { SharedSource } from "@/runtime/react/source"
import type { SharedLanguage } from "@/runtime/react/language"
import type { ConnectMethod } from "./method"
import { ConnectMethodSwitch } from "./method.react"
import type { RedeemPairing } from "./redeem"

const PairingScannerView = lazy(async () => {
  const { PairingScannerView } = await import("./scanner.react")
  return { default: PairingScannerView }
})

type ConnectState = {
  method: ConnectMethod
  link: string
  url: string
  password: string
  error: string
  scanning: boolean
}

export function ConnectServerView(props: {
  source: SharedSource<{
    language: SharedLanguage
    state: ConnectState
    busy: boolean
    web: boolean
    cameraAvailable: boolean
    cameraLoading: boolean
    cameraHint: string
  }>
  submit: () => void
  update: (patch: Partial<ConnectState>) => void
  redeem: RedeemPairing
  scan: (link: string) => void
  stopScan: () => void
}) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  const language = view.language
  const state = view.state
  return (
    <main data-component="connect-server" aria-labelledby="server-connect-title">
      <div className="server-connect-content">
        <div className="server-connect-brand">
          <Logo />
        </div>
        <header>
          <h1 id="server-connect-title">{language.t("server.connect.title")}</h1>
          <p>
            {language.t(state.method === "link" ? "server.connect.description.pairing" : "server.connect.description")}
          </p>
        </header>
        {state.scanning ? (
          <Suspense fallback={<p role="status">{language.t("server.connect.camera.starting")}</p>}>
            <PairingScannerView
              language={language}
              redeem={props.redeem}
              onScan={props.scan}
              onCancel={props.stopScan}
            />
          </Suspense>
        ) : (
          <>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                props.submit()
              }}
            >
              <div className="server-connect-field">
                <label htmlFor="server-connect-address">
                  {language.t(state.method === "link" ? "server.connect.link" : "dialog.server.add.url")}
                </label>
                <Input
                  id="server-connect-address"
                  name={state.method === "link" ? "link" : "server"}
                  dir="ltr"
                  type="text"
                  inputMode="url"
                  autoComplete={state.method === "password" ? "url" : undefined}
                  autoCapitalize="off"
                  spellCheck={false}
                  required
                  controlSize="lg"
                  className="min-h-11 text-base leading-6"
                  placeholder={language.t(
                    state.method === "link" ? "server.connect.link.placeholder" : "dialog.server.add.placeholder",
                  )}
                  value={state.method === "link" ? state.link : state.url}
                  disabled={view.busy}
                  aria-invalid={!!state.error}
                  aria-describedby={state.error ? "server-connect-error" : undefined}
                  onValueChange={(value) =>
                    props.update(state.method === "link" ? { link: value, error: "" } : { url: value, error: "" })
                  }
                />
              </div>
              {state.method === "password" && (
                <div className="server-connect-field">
                  <label htmlFor="server-connect-password">{language.t("dialog.server.add.password")}</label>
                  <Input
                    id="server-connect-password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    controlSize="lg"
                    className="min-h-11 text-base leading-6"
                    value={state.password}
                    disabled={view.busy}
                    aria-describedby="server-connect-password-hint"
                    onValueChange={(password) => props.update({ password, error: "" })}
                  />
                  <p id="server-connect-password-hint" className="server-connect-hint">
                    {language.t("server.connect.password.hint")}
                  </p>
                </div>
              )}
              {state.error && (
                <p id="server-connect-error" className="server-connect-error" role="alert">
                  {state.error}
                </p>
              )}
              <Button
                type="submit"
                variant="primary"
                size="lg"
                disabled={view.busy || !(state.method === "link" ? state.link : state.url).trim()}
              >
                {language.t(view.busy ? "dialog.server.add.checking" : "server.connect.button")}
              </Button>
            </form>
            {state.method === "link" &&
              view.web &&
              (view.cameraAvailable || view.cameraLoading ? (
                <Button
                  variant="secondary"
                  size="lg"
                  disabled={view.busy || !view.cameraAvailable}
                  onClick={() => props.update({ scanning: true })}
                >
                  {language.t("server.connect.scan")}
                </Button>
              ) : (
                <p>{view.cameraHint}</p>
              ))}
            <ConnectMethodSwitch
              language={language}
              method={state.method}
              disabled={view.busy}
              onChange={(method) => props.update({ method, error: "" })}
            />
            {state.method === "link" && (
              <footer>
                <p>{language.t("server.connect.pair.link")}</p>
                <code dir="ltr">redcode pair</code>
              </footer>
            )}
          </>
        )}
      </div>
    </main>
  )
}
