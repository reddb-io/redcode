/** @jsxImportSource react */
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react"
import { Badge } from "@reddb-io/design-system/base/Badge"
import { Input } from "@reddb-io/design-system/base/Input"
import { ListRow } from "@reddb-io/design-system/app/ListRow"
import type { IntegrationInfo } from "@opencode/client/promise"
import { IntegrationConnections } from "@opencode/util/integration-connections"
import { IntegrationOrder } from "@opencode/util/integration-order"
import { Icon } from "@/runtime/react/icon.react"
import { ProviderModelIcon } from "@/settings/providers/provider-icon.react"
import { connectOptions } from "@/providers/catalog/connect-order"
import { OPENAI_COMPATIBLE } from "@/providers/catalog/ids"
import type { createProviderPickerServices } from "./picker"

export function ProviderPickerView(props: { services: ReturnType<typeof createProviderPickerServices> }) {
  const view = useSyncExternalStore(props.services.snapshot.subscribe, props.services.snapshot.getSnapshot)
  const language = view.language
  const [filter, setFilter] = useState("")
  const [active, setActive] = useState<string>()
  const picker = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const rows = connectOptions(view.items, filter)
  const sections = [...new Set(rows.map(IntegrationOrder.category))].map((category) => ({
    category,
    items: rows.filter((item) => IntegrationOrder.category(item) === category),
  }))
  useEffect(() => {
    search.current?.focus({ preventScroll: true })
  }, [])

  const move = (event: KeyboardEvent, direction: 1 | -1) => {
    const items = rows.filter(canConnect)
    if (!items.length) return
    const index = items.findIndex((item) => item.id === active)
    const next =
      index < 0 ? (direction === 1 ? 0 : items.length - 1) : (index + direction + items.length) % items.length
    setActive(items[next].id)
    picker.current
      ?.querySelector<HTMLElement>(`[data-provider-id="${CSS.escape(items[next].id)}"]`)
      ?.focus({ preventScroll: true })
    event.preventDefault()
  }
  return (
    <div
      ref={picker}
      className="flex min-h-0 flex-1 flex-col gap-4"
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") return move(event, 1)
        if (event.key === "ArrowUp") return move(event, -1)
        if (event.key !== "Enter" || !active || !rows.some((item) => item.id === active && canConnect(item))) return
        event.preventDefault()
        props.services.select(active)
      }}
    >
      <div className="shrink-0 px-1 pt-px">
        <Input
          ref={search}
          type="search"
          className="w-full"
          aria-label={language.t("dialog.provider.search.placeholder")}
          placeholder={language.t("dialog.provider.search.placeholder")}
          value={filter}
          onValueChange={(value) => {
            setFilter(value)
            setActive(undefined)
          }}
        />
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="flex size-full min-h-0 flex-col gap-4 overflow-y-auto pb-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sections.map(({ category, items }) => (
            <section key={category} className="flex flex-col" data-section={category}>
              <h3 className="m-0 px-3 pb-2 text-eyebrow uppercase text-ink-muted">
                {language.t(
                  category === "Connected"
                    ? "dialog.provider.group.connected"
                    : category === "Popular"
                      ? "dialog.provider.group.popular"
                      : "dialog.provider.group.services",
                )}
              </h3>
              {items.map((integration) => {
                const summary = IntegrationConnections.connectionSummary(integration)
                const environmentOnly = !IntegrationConnections.connectMethods(integration).length
                return (
                  <ListRow
                    key={integration.id}
                    data-provider-id={integration.id}
                    className="min-h-9 py-2 text-body"
                    selected={active === integration.id}
                    disabled={!canConnect(integration)}
                    onMouseEnter={() => setActive(integration.id)}
                    onClick={() => props.services.select(integration.id)}
                    leading={<ProviderModelIcon provider={integration} className="shrink-0 text-foreground" />}
                    trailing={
                      <>
                        {summary && (
                          <span className="min-w-0 max-w-48 truncate text-caption text-ink-muted">{summary}</span>
                        )}
                        {integration.connections.length > 0 && (
                          <>
                            <Icon name="check" size="small" className="shrink-0 text-feedback-success-foreground" />
                            <span className="sr-only">{language.t("dialog.provider.connected")}</span>
                          </>
                        )}
                      </>
                    }
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate font-medium text-foreground">{integration.name}</span>
                        {integration.id === "red-router" && (
                          <Badge>{language.t("dialog.provider.tag.recommended")}</Badge>
                        )}
                        {integration.id === OPENAI_COMPATIBLE && (
                          <Badge>{language.t("settings.providers.tag.custom")}</Badge>
                        )}
                        {integration.role === "admin" && <Badge>{language.t("settings.providers.tag.adminKey")}</Badge>}
                        {integration.role === "standard" && (
                          <Badge>{language.t("settings.providers.tag.standardKey")}</Badge>
                        )}
                      </span>
                      {integration.id === OPENAI_COMPATIBLE && (
                        <span className="min-w-0 truncate text-caption text-ink-muted">
                          {language.t("dialog.provider.custom.description")}
                        </span>
                      )}
                      {environmentOnly && (
                        <span className="min-w-0 truncate text-caption text-ink-muted">
                          {language.t("dialog.provider.environmentOnly")}
                        </span>
                      )}
                    </span>
                  </ListRow>
                )
              })}
            </section>
          ))}
          {!rows.length && (
            <div role="status" className="flex h-24 items-center justify-center text-body text-ink-muted">
              {language.t("dialog.provider.empty")}
            </div>
          )}
        </div>
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10"
          style={{ background: "linear-gradient(to bottom, transparent, var(--v2-background-bg-layer-01))" }}
        />
      </div>
    </div>
  )
}

function canConnect(integration: IntegrationInfo) {
  return (
    IntegrationConnections.connectMethods(integration).length > 0 ||
    IntegrationConnections.credentialConnections(integration).length > 0
  )
}
