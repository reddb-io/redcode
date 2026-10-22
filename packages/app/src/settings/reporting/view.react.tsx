/** @jsxImportSource react */
import { useEffect, useId, useState, useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Input } from "@reddb-io/design-system/base/Input"
import { Select } from "@reddb-io/design-system/base/Select"
import { Switch } from "@reddb-io/design-system/base/Switch"
import type { createReportingServices } from "./reporting"
import { SettingsList, SettingsRow } from "../shared.react"

type Snapshot = Awaited<
  ReturnType<ReturnType<ReturnType<typeof createReportingServices>["getSnapshot"]>["api"]["snapshot"]>
>
export function Reporting(props: { source: ReturnType<typeof createReportingServices> }) {
  const services = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  const language = services.language
  const api = services.api
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [unavailable, setUnavailable] = useState(false)
  const [form, setForm] = useState({
    enabled: false,
    transport: "webhook" as "webhook" | "reddb",
    url: "",
    queue: "usage_events",
    secret: "",
  })
  const secretHelp = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    const owner = { active: true }
    void api.snapshot().then(
      (value) => {
        if (!owner.active) return
        setSnapshot(value)
        setForm((previous) => ({ ...previous, ...value.config }))
        setUnavailable(false)
      },
      () => {
        if (owner.active) setUnavailable(true)
      },
    )
    return () => {
      owner.active = false
    }
  }, [api])
  const run = async (action: () => Promise<Snapshot>) => {
    setBusy(true)
    setError("")
    await action().then(setSnapshot, () => setError(language.t("reporting.requestFailed")))
    setBusy(false)
  }
  return (
    <>
      <div className="settings-tab-header">
        <h2 className="settings-tab-title">{language.t("reporting.title")}</h2>
        <p className="text-13-regular text-ink-muted">{language.t("reporting.description")}</p>
      </div>
      <div className="settings-tab-body settings-tab-body--sectioned">
        {unavailable && <p role="alert">{language.t("reporting.unavailable")}</p>}
        {snapshot && (
          <>
            <section className="settings-section">
              <h3 className="settings-section-title">{language.t("reporting.destination")}</h3>
              <SettingsList>
                <SettingsRow
                  title={language.t("reporting.enabled")}
                  description={language.t("reporting.enabledDescription")}
                >
                  {(association) => (
                    <Switch
                      {...association}
                      label={language.t("reporting.enabled")}
                      fieldClass="settings-react-switch"
                      checked={form.enabled}
                      disabled={busy}
                      onCheckedChange={(enabled) => setForm((previous) => ({ ...previous, enabled }))}
                    />
                  )}
                </SettingsRow>
                <SettingsRow
                  title={language.t("reporting.transport")}
                  description={language.t("reporting.transportDescription")}
                >
                  {(association) => (
                    <Select
                      {...association}
                      value={form.transport}
                      disabled={busy}
                      options={(["webhook", "reddb"] as const).map((value) => ({
                        value,
                        label: language.t(value === "webhook" ? "reporting.webhook" : "reporting.reddb"),
                      }))}
                      onValueChange={(transport) => {
                        if (transport === "webhook" || transport === "reddb")
                          setForm((previous) => ({ ...previous, transport }))
                      }}
                    />
                  )}
                </SettingsRow>
              </SettingsList>
              <div className="flex flex-col gap-4 mt-4">
                <label className="flex flex-col gap-1">
                  {language.t("reporting.url")}
                  <Input
                    value={form.url}
                    disabled={busy}
                    onValueChange={(url) => setForm((previous) => ({ ...previous, url }))}
                  />
                </label>
                {form.transport === "reddb" && (
                  <label className="flex flex-col gap-1">
                    {language.t("reporting.queue")}
                    <Input
                      value={form.queue}
                      disabled={busy}
                      onValueChange={(queue) => setForm((previous) => ({ ...previous, queue }))}
                    />
                  </label>
                )}
                <label className="flex flex-col gap-1">
                  {language.t(form.transport === "webhook" ? "reporting.signingSecret" : "reporting.accessToken")}
                  <Input
                    type="password"
                    aria-label={language.t(
                      form.transport === "webhook" ? "reporting.signingSecret" : "reporting.accessToken",
                    )}
                    aria-describedby={secretHelp}
                    autoComplete="new-password"
                    value={form.secret}
                    disabled={busy}
                    onValueChange={(secret) => setForm((previous) => ({ ...previous, secret }))}
                  />
                  <span id={secretHelp} className="text-12-regular text-ink-muted">
                    {language.t(
                      snapshot.config.secretConfigured ? "reporting.secretSaved" : "reporting.secretDescription",
                    )}
                  </span>
                </label>
                <p className="text-12-regular text-ink-muted">{language.t("reporting.privacy")}</p>
                <div className="flex gap-2">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const value = await api.configure({
                          enabled: form.enabled,
                          transport: form.transport,
                          url: form.url,
                          queue: form.queue,
                          ...(form.secret ? { secret: form.secret } : {}),
                        })
                        setForm((previous) => ({ ...previous, secret: "" }))
                        return value
                      })
                    }
                  >
                    {language.t("common.save")}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy || !snapshot.config.enabled}
                    onClick={() => void run(() => api.flush())}
                  >
                    {language.t("reporting.flush")}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void api.snapshot().then(
                        (value) => {
                          setSnapshot(value)
                          setUnavailable(false)
                        },
                        () => setUnavailable(true),
                      )
                    }
                  >
                    {language.t("reporting.refresh")}
                  </Button>
                </div>
                {error && <p role="alert">{error}</p>}
              </div>
            </section>
            <section className="settings-section">
              <h3 className="settings-section-title">{language.t("reporting.deliveries")}</h3>
              <p className="text-12-regular text-ink-muted">{language.t("reporting.counts", snapshot.counts)}</p>
              {snapshot.deliveries.length ? (
                <SettingsList>
                  {snapshot.deliveries.map((delivery) => (
                    <SettingsRow
                      key={delivery.id}
                      title={
                        <span>
                          {language.t(`reporting.stage.${delivery.record.stage}`)} ·{" "}
                          {delivery.record.model ?? language.t(`reporting.operation.${delivery.record.operation}`)}
                        </span>
                      }
                      description={language.t("reporting.delivery", {
                        status: language.t(`reporting.status.${delivery.status}`),
                        attempts: delivery.attempts,
                        session: delivery.record.sessionID,
                      })}
                    >
                      {() =>
                        (delivery.status === "dead" || delivery.status === "pending") && (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => void run(() => api.retry({ id: delivery.id }))}
                            >
                              {language.t("reporting.retry")}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy || !snapshot.config.enabled}
                              onClick={() => void run(() => api.retry({ id: delivery.id, destination: "current" }))}
                            >
                              {language.t("reporting.retryCurrent")}
                            </Button>
                          </>
                        )
                      }
                    </SettingsRow>
                  ))}
                </SettingsList>
              ) : (
                <p>{language.t("reporting.empty")}</p>
              )}
            </section>
          </>
        )}
      </div>
    </>
  )
}
