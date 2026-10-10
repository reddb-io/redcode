import { Badge } from "@opencode/ui/badge"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { TextInput } from "@opencode/ui/text-input"
import { ConnectionCheck } from "@opencode/schema/connection-check"
import { ModelPresentation } from "@opencode/schema/model-presentation"
import { IntegrationConnections } from "@opencode/util/integration-connections"
import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { useData } from "@/runtime/server/current"
import { useIntegrations } from "@/providers/catalog/integrations"
import { connectedProviderID } from "@/providers/catalog/connect-order"
import { ProviderModelIcon } from "@/providers/models/provider-group"
import { showToast } from "@/shell/notifications/toast"
import { SettingsList } from "@/settings/list"

/**
 * One integration's saved connections, as the TUI manages them: switch the active account, rename or
 * delete a connection, add another account or endpoint, and test the active one against the remote API.
 */
export function IntegrationConnectionsPane(props: {
  integrationID: string
  directory?: string
  /** Shows the integration's icon and name above the list, for hosts without their own title. */
  heading?: boolean
  onAdd: () => void
  onPickModel?: (provider: string) => void
}) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const data = useData()
  const integrations = useIntegrations(() => props.directory)
  const location = () => (props.directory ? { directory: props.directory } : undefined)

  const [state, setState] = createStore<{
    busy?: string
    renaming?: string
    label: string
    deleting?: string
    checking: boolean
    report?: ConnectionCheck.Report
  }>({ label: "", checking: false })

  const integration = createMemo(() => integrations.list().find((item) => item.id === props.integrationID))
  const connections = createMemo(() => {
    const value = integration()

    return value ? IntegrationConnections.credentialConnections(value) : []
  })
  const methods = createMemo(() => {
    const value = integration()

    return value ? IntegrationConnections.connectMethods(value) : []
  })
  const name = () => integration()?.name ?? props.integrationID

  // A RedRouter connection says what its key may do; the saved router connection describes the active key.
  const keyRole = () => {
    const role = ModelPresentation.integrationRouterProvider(
      data.location.provider.list(location()) ?? [],
      props.integrationID,
    )?.router?.role

    if (role === "admin") return language.t("settings.providers.tag.adminKey")

    if (role === "standard") return language.t("settings.providers.tag.standardKey")

    return undefined
  }

  const refresh = () => {
    const ref = location()
    data.location.integration.invalidate(ref)
    data.location.provider.invalidate(ref)
    data.location.model.invalidate(ref)

    return Promise.all([
      data.location.integration.sync(ref),
      data.location.provider.sync(ref),
      data.location.model.sync(ref),
    ])
  }

  const fail = (error: unknown) =>
    showToast({ title: language.t("common.requestFailed"), description: formatServerError(error, language.t) })

  const activate = (credentialID: string, label: string) => {
    if (state.busy || connections()[0]?.id === credentialID) return
    setState({ busy: credentialID, report: undefined })
    void sdk.api.credential
      .activate({ credentialID })
      .then(refresh)
      .then(() =>
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("settings.providers.account.switched.title", { provider: name() }),
          description: language.t("settings.providers.account.switched.description", { account: label }),
        }),
      )
      .catch(fail)
      .finally(() => setState("busy", undefined))
  }

  const rename = (credentialID: string) => {
    const label = state.label.trim()

    if (!label) return
    setState("busy", credentialID)
    void sdk.api.credential
      .update({ credentialID, label })
      .then(refresh)
      .then(() => setState("renaming", undefined))
      .catch(fail)
      .finally(() => setState("busy", undefined))
  }

  // Deleting asks twice, so one stray click never drops a saved key.
  const remove = (credentialID: string) => {
    if (state.deleting !== credentialID) {
      setState("deleting", credentialID)

      return
    }

    const final = connections().length === 1
    setState({ busy: credentialID, deleting: undefined })
    void sdk.api.credential
      .remove({ credentialID })
      .then(refresh)
      .then(() => {
        if (!final) return
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name() }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name() }),
        })
      })
      .catch(fail)
      .finally(() => setState("busy", undefined))
  }

  const check = async () => {
    if (state.checking) return
    setState({ checking: true, report: undefined })
    const report = await sdk.api.integration.check({ integrationID: props.integrationID, location: location() }).catch(
      (error: unknown): ConnectionCheck.Report => ({
        ok: false,
        message: formatServerError(error, language.t),
        requests: ConnectionCheck.requestsFrom(error),
      }),
    )
    setState({ checking: false, report })
  }

  const pickModel = () => {
    const provider = connectedProviderID(
      data.location.provider.list(location()) ?? [],
      data.location.model.list(location()) ?? [],
      props.integrationID,
    )

    props.onPickModel?.(provider ?? props.integrationID)
  }

  return (
    <div data-component="integration-connections" class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pb-3">
      <Show when={props.heading}>
        <div class="flex items-center gap-2">
          <ProviderModelIcon provider={{ id: props.integrationID, name: name() }} class="shrink-0 text-foreground" />
          <span class="text-[15px] font-medium leading-5 tracking-[-0.13px] text-foreground">{name()}</span>
        </div>
      </Show>
      <section class="flex flex-col gap-2">
        <h3 class="m-0 text-eyebrow uppercase text-ink-muted">{language.t("provider.manage.saved")}</h3>
        <SettingsList variant="catalog">
          <Show when={connections().length === 0}>
            <div data-component="settings-row" class="text-[13px] text-ink-muted">
              {language.t("provider.manage.empty")}
            </div>
          </Show>
          <For each={connections()}>
            {(connection, index) => (
              <div data-component="settings-row" data-credential-id={connection.id} class="!flex-nowrap !gap-2">
                <div data-slot="settings-row-copy">
                  <Show
                    when={state.renaming === connection.id}
                    fallback={
                      <div data-slot="settings-row-title" class="flex min-w-0 items-center gap-2">
                        <span class="min-w-0 truncate">{connection.label}</span>
                        <Show when={index() === 0}>
                          <Badge class="shrink-0">{language.t("settings.providers.account.active")}</Badge>
                          <Show when={keyRole()}>{(role) => <Badge class="shrink-0">{role()}</Badge>}</Show>
                        </Show>
                      </div>
                    }
                  >
                    <form
                      class="flex items-center gap-2"
                      onSubmit={(event) => {
                        event.preventDefault()
                        rename(connection.id)
                      }}
                    >
                      <TextInput
                        ref={(input: HTMLInputElement) => queueMicrotask(() => input.select())}
                        class="!w-full"
                        aria-label={language.t("provider.manage.rename.label")}
                        value={state.label}
                        onInput={(event) => setState("label", event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key !== "Escape") return
                          event.stopPropagation()
                          setState("renaming", undefined)
                        }}
                      />
                      <Button type="submit" variant="contrast" disabled={!state.label.trim() || !!state.busy}>
                        {language.t("common.save")}
                      </Button>
                    </form>
                  </Show>
                </div>
                <Show when={state.renaming !== connection.id}>
                  <div data-slot="settings-row-control" class="flex items-center gap-1">
                    <Show when={index() !== 0}>
                      <Button
                        variant="ghost-muted"
                        disabled={!!state.busy}
                        aria-busy={state.busy === connection.id}
                        onClick={() => activate(connection.id, connection.label)}
                      >
                        {language.t("provider.manage.activate")}
                      </Button>
                    </Show>
                    <IconButton
                      variant="ghost-muted"
                      icon={<Icon name="pencil-line" size="small" />}
                      aria-label={language.t("provider.manage.rename", { account: connection.label })}
                      title={language.t("provider.manage.rename", { account: connection.label })}
                      disabled={!!state.busy}
                      onClick={() =>
                        setState({ renaming: connection.id, label: connection.label, deleting: undefined })
                      }
                    />
                    <Show
                      when={state.deleting === connection.id}
                      fallback={
                        <IconButton
                          variant="ghost-muted"
                          icon={<Icon name="trash" size="small" />}
                          aria-label={language.t("provider.manage.delete", { account: connection.label })}
                          title={language.t("provider.manage.delete", { account: connection.label })}
                          disabled={!!state.busy}
                          onClick={() => remove(connection.id)}
                        />
                      }
                    >
                      <Button variant="neutral" disabled={!!state.busy} onClick={() => remove(connection.id)}>
                        {language.t("provider.manage.delete.confirm")}
                      </Button>
                    </Show>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </SettingsList>
      </section>
      <div class="flex flex-wrap items-center gap-2">
        <Show when={methods().length > 0}>
          <Button variant="neutral" icon="plus" disabled={!!state.busy} onClick={props.onAdd}>
            {language.t("provider.manage.add")}
          </Button>
        </Show>
        <Show when={integration()?.metadata?.source !== "mcp"}>
          <Button variant="neutral" disabled={state.checking} aria-busy={state.checking} onClick={() => void check()}>
            {language.t(state.checking ? "provider.manage.check.running" : "provider.manage.check")}
          </Button>
        </Show>
        <Show when={props.onPickModel}>
          <Button variant="contrast" onClick={pickModel}>
            {language.t("provider.manage.pickModel")}
          </Button>
        </Show>
      </div>
      <Show when={state.report}>
        {(report) => (
          <div
            role="status"
            data-component="connection-check-report"
            data-ok={report().ok ? "" : undefined}
            class="flex flex-col gap-2 rounded-md border border-muted p-3 text-[13px] leading-5"
          >
            <div class="flex items-center gap-2 font-medium text-foreground">
              <Icon
                name={report().ok ? "circle-check" : "circle-ban-sign"}
                size="small"
                class={report().ok ? "text-feedback-success-foreground" : "text-feedback-danger-foreground"}
              />
              {language.t(report().ok ? "provider.manage.check.passed" : "provider.manage.check.failed")}
            </div>
            <p class="m-0 text-ink-muted">{report().message}</p>
            <Show when={ConnectionCheck.describe(report().requests)}>
              {(details) => (
                <pre class="m-0 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-4 text-ink-muted">
                  {details()}
                </pre>
              )}
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}

/** Settings › Providers opens one integration's connections in a dialog of their own. */
export function DialogManageIntegration(props: {
  integrationID: string
  name: string
  directory?: string
  onAdd: () => void
}) {
  const language = useLanguage()

  return (
    <Dialog size="large" variant="settings">
      <DialogHeader closeLabel={language.t("common.close")}>
        <DialogTitleGroup
          title={language.t("provider.manage.title", { provider: props.name })}
          description={language.t("provider.manage.description")}
        />
      </DialogHeader>
      <DialogBody class="flex min-h-0 flex-1 flex-col px-2 pb-4">
        <IntegrationConnectionsPane
          integrationID={props.integrationID}
          directory={props.directory}
          onAdd={props.onAdd}
        />
      </DialogBody>
    </Dialog>
  )
}
