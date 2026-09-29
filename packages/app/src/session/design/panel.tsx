import { createResource, For, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import type { DesignInfo } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { ScrollView } from "@opencode/ui/scroll-view"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import type { SessionDesignModel } from "./model"
import { designStatus } from "./state"

/** The Design tab: the session's designs with their review state, and the way into the browser review. */
export function SessionDesignPanel(props: { design: SessionDesignModel }) {
  const language = useLanguage()
  const server = useServerSDK()
  const [store, setStore] = createStore({ opening: false })
  const [designs, { refetch }] = createResource(
    () => {
      const sessionID = props.design.sessionID()
      return sessionID ? { sessionID, activity: props.design.activity() } : undefined
    },
    (input) => server.api.session.design.list({ sessionID: input.sessionID }),
  )
  // Reading an unresolved resource would suspend the whole side panel, so only settled values are read.
  const list = () => (designs.state === "ready" || designs.state === "refreshing" ? designs.latest : undefined)
  const openReview = () => {
    const sessionID = props.design.sessionID()
    if (!sessionID || store.opening) return
    setStore("opening", true)
    void props.design.openReview(sessionID).finally(() => setStore("opening", false))
  }

  return (
    <div class="flex h-full min-h-0 flex-col bg-v2-background-bg-base" data-slot="session-design-panel">
      <div class="flex shrink-0 items-center justify-between gap-3 border-b border-v2-border-border-base px-5 py-3">
        <div class="min-w-0 truncate text-13-medium text-v2-text-text-base">{language.t("session.design.title")}</div>
        <div class="flex shrink-0 items-center gap-2">
          <Tooltip value={language.t("session.design.refresh")}>
            <IconButton
              size="small"
              variant="ghost-muted"
              icon={<Icon name="refresh" />}
              aria-label={language.t("session.design.refresh")}
              disabled={designs.loading}
              onClick={() => void refetch()}
            />
          </Tooltip>
          <Button size="small" variant="outline" disabled={store.opening || !list()?.length} onClick={openReview}>
            {language.t("session.design.review.open")}
          </Button>
        </div>
      </div>

      <div class="relative min-h-0 flex-1">
        <Switch>
          <Match when={designs.error}>
            <div class="flex h-full flex-col items-center justify-center gap-3 px-8 pb-24 text-center">
              <div class="text-13-regular text-text-weak">{language.t("session.design.error")}</div>
              <Button size="small" variant="outline" onClick={() => void refetch()}>
                {language.t("common.retry")}
              </Button>
            </div>
          </Match>
          <Match when={list() === undefined}>
            <div class="px-5 py-4 text-13-regular text-text-weak" role="status">
              {language.t("session.design.loading")}
            </div>
          </Match>
          <Match when={list()?.length === 0}>
            <div class="flex h-full items-center justify-center px-8 pb-24 text-center text-13-regular text-text-weak">
              {language.t("session.design.empty")}
            </div>
          </Match>
          <Match when={list()}>
            {(items) => (
              <ScrollView class="absolute inset-0">
                <ul class="flex flex-col pb-8">
                  <For each={items()}>{(design) => <SessionDesignRow design={design} />}</For>
                </ul>
              </ScrollView>
            )}
          </Match>
        </Switch>
      </div>
    </div>
  )
}

const statusLabels = {
  draft: "session.design.status.draft",
  review: "session.design.status.review",
  approved: "session.design.status.approved",
  closed: "session.design.status.closed",
} as const

function SessionDesignRow(props: { design: DesignInfo }) {
  const language = useLanguage()
  const status = () => designStatus(props.design)
  const target = () => {
    if (props.design.target === "app")
      return props.design.platform === "android"
        ? language.t("session.design.target.android")
        : props.design.platform === "ios"
          ? language.t("session.design.target.ios")
          : language.t("session.design.target.app")
    if (props.design.target === "presentation") return language.t("session.design.target.presentation")
    if (props.design.target === "web") return language.t("session.design.target.web")
  }
  return (
    <li
      data-slot="session-design-row"
      data-status={status()}
      class="flex min-w-0 flex-col gap-1 border-b border-v2-border-border-base px-5 py-3"
    >
      <div class="flex min-w-0 items-center justify-between gap-3">
        <bdi dir="auto" class="min-w-0 truncate text-13-medium text-v2-text-text-base">
          {props.design.name}
        </bdi>
        <span
          class="shrink-0 text-12-medium"
          classList={{
            "text-v2-text-text-accent": status() === "approved",
            "text-v2-text-text-muted": status() !== "approved",
          }}
        >
          {language.t(statusLabels[status()])}
        </span>
      </div>
      <div class="flex min-w-0 flex-wrap items-center gap-x-2 text-12-regular text-v2-text-text-muted">
        <Show when={target()}>{(value) => <span>{value()}</span>}</Show>
        <Show when={props.design.revision}>
          {(revision) => (
            <span class="truncate">{language.t("session.design.revision", { revision: revision() })}</span>
          )}
        </Show>
        <Show when={props.design.approvedRevision && props.design.approvedRevision !== props.design.revision}>
          <span class="truncate">
            {language.t("session.design.approvedRevision", { revision: props.design.approvedRevision ?? "" })}
          </span>
        </Show>
      </div>
      <Show when={props.design.designSystem.trim()}>
        {(name) => (
          <div class="min-w-0 truncate text-12-regular text-v2-text-text-faint">
            {language.t("session.design.system", { name: name() })}
          </div>
        )}
      </Show>
    </li>
  )
}
