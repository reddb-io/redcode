import { Button } from "@opencode/ui/button"
import { TextField } from "@opencode/ui/text-field"
import { Switch } from "@opencode/ui/switch"
import { Select } from "@opencode/ui/select"
import { createResource, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useServer } from "@/runtime/server/current"
import { useLanguage } from "@/runtime/i18n/language"
import { SettingsRow } from "@/settings/row"
import { SettingsList } from "@/settings/list"

export function SettingsReporting() {
  const language = useLanguage()
  const server = useServer()
  const api = () => server.ctx.sdk.api.usageReporter
  const [state, setState] = createStore({
    enabled: false,
    transport: "webhook" as "webhook" | "reddb",
    url: "",
    queue: "usage_events",
    secret: "",
    busy: false,
    error: "",
    loaded: false,
  })
  const [snapshot, actions] = createResource(async () => {
    const value = await api().snapshot()
    if (!state.loaded) setState({ ...value.config, loaded: true })
    return value
  })
  const run = async (action: () => ReturnType<ReturnType<typeof api>["snapshot"]>) => {
    setState({ busy: true, error: "" })
    try {
      const value = await action()
      actions.mutate(value)
    } catch {
      // Transport/server errors can contain arbitrary response bodies. Keep reporting UI errors controlled.
      setState("error", language.t("reporting.requestFailed"))
    } finally {
      setState("busy", false)
    }
  }
  return (
    <>
      <div class="settings-tab-header">
        <h2 class="settings-tab-title">{language.t("reporting.title")}</h2>
        <p class="text-13-regular text-ink-muted">{language.t("reporting.description")}</p>
      </div>
      <div class="settings-tab-body settings-tab-body--sectioned">
        <Show when={snapshot.error}>
          <p role="alert">{language.t("reporting.unavailable")}</p>
        </Show>
        <Show when={state.loaded}>
          <section class="settings-section">
            <h3 class="settings-section-title">{language.t("reporting.destination")}</h3>
            <SettingsList>
              <SettingsRow
                title={language.t("reporting.enabled")}
                description={language.t("reporting.enabledDescription")}
              >
                <Switch
                  checked={state.enabled}
                  onChange={(value) => setState("enabled", value)}
                  disabled={state.busy}
                  hideLabel
                >
                  {language.t("reporting.enabled")}
                </Switch>
              </SettingsRow>
              <SettingsRow
                title={language.t("reporting.transport")}
                description={language.t("reporting.transportDescription")}
              >
                <Select
                  options={["webhook", "reddb"]}
                  current={state.transport}
                  onSelect={(value) => value && setState("transport", value as "webhook" | "reddb")}
                  label={(value) => language.t(value === "webhook" ? "reporting.webhook" : "reporting.reddb")}
                />
              </SettingsRow>
            </SettingsList>
            <div class="flex flex-col gap-4 mt-4">
              <TextField
                label={language.t("reporting.url")}
                value={state.url}
                onChange={(value) => setState("url", value)}
                disabled={state.busy}
              />
              <Show when={state.transport === "reddb"}>
                <TextField
                  label={language.t("reporting.queue")}
                  value={state.queue}
                  onChange={(value) => setState("queue", value)}
                  disabled={state.busy}
                />
              </Show>
              <TextField
                type="password"
                autocomplete="new-password"
                label={language.t(state.transport === "webhook" ? "reporting.signingSecret" : "reporting.accessToken")}
                description={language.t(
                  snapshot()?.config.secretConfigured ? "reporting.secretSaved" : "reporting.secretDescription",
                )}
                value={state.secret}
                onChange={(value) => setState("secret", value)}
                disabled={state.busy}
              />
              <p class="text-12-regular text-ink-muted">{language.t("reporting.privacy")}</p>
              <div class="flex gap-2">
                <Button
                  disabled={state.busy}
                  onClick={() =>
                    void run(async () => {
                      const value = await api().configure({
                        enabled: state.enabled,
                        transport: state.transport,
                        url: state.url,
                        queue: state.queue,
                        ...(state.secret ? { secret: state.secret } : {}),
                      })
                      setState("secret", "")
                      return value
                    })
                  }
                >
                  {language.t("common.save")}
                </Button>
                <Button
                  variant="outline"
                  disabled={state.busy || !snapshot()?.config.enabled}
                  onClick={() => void run(() => api().flush())}
                >
                  {language.t("reporting.flush")}
                </Button>
                <Button variant="outline" disabled={state.busy} onClick={() => void actions.refetch()}>
                  {language.t("reporting.refresh")}
                </Button>
              </div>
              <Show when={state.error}>
                <p role="alert">{state.error}</p>
              </Show>
            </div>
          </section>
          <section class="settings-section">
            <h3 class="settings-section-title">{language.t("reporting.deliveries")}</h3>
            <p class="text-12-regular text-ink-muted">
              {language.t("reporting.counts", snapshot()?.counts ?? { pending: 0, delivered: 0, dead: 0 })}
            </p>
            <Show when={snapshot()?.deliveries.length} fallback={<p>{language.t("reporting.empty")}</p>}>
              <SettingsList>
                <For each={snapshot()?.deliveries}>
                  {(delivery) => (
                    <SettingsRow
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
                      <Show when={delivery.status === "dead" || delivery.status === "pending"}>
                        <Button
                          size="small"
                          variant="outline"
                          disabled={state.busy}
                          onClick={() => void run(() => api().retry({ id: delivery.id }))}
                        >
                          {language.t("reporting.retry")}
                        </Button>
                        <Button
                          size="small"
                          variant="outline"
                          disabled={state.busy || !snapshot()?.config.enabled}
                          onClick={() => void run(() => api().retry({ id: delivery.id, destination: "current" }))}
                        >
                          {language.t("reporting.retryCurrent")}
                        </Button>
                      </Show>
                    </SettingsRow>
                  )}
                </For>
              </SettingsList>
            </Show>
          </section>
        </Show>
      </div>
    </>
  )
}
