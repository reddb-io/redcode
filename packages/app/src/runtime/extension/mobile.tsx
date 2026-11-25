import { createMemo, For, lazy, Show, Suspense, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Tabs } from "@opencode/ui/tabs"
import { ReactView } from "@opencode/ui/react-view"
import { sharedLanguage } from "@/runtime/react/language"
import { PanelChoices } from "./panel-choices.react"
import {
  Panel,
  type PanelSidebar,
  type PanelTab,
  type MountedSession,
  type SessionScreen,
} from "@opencode/gui-extensions/sdk"
import { useLanguage } from "@/runtime/i18n/language"
import { useExtensionHost } from "./host"
import { panelKey } from "./panel-keys"
import { MobilePanel, type Region, type RegionEntry } from "./panels"

const MobilePanelDrawer = lazy(async () => {
  const { MobilePanelDrawer } = await import("@/shell/mobile-panel-drawer")

  return { default: MobilePanelDrawer }
})

export type MobileEntry = RegionEntry & { readonly mobile: NonNullable<Panel["mobile"]> }

/** Panels that offer a narrow-screen view, keyed `${extension}:${panel id}`. */
export function createMobileViews() {
  const host = useExtensionHost()

  const entries = createMemo(() =>
    host.items(Panel).flatMap((item): MobileEntry[] => {
      const mobile = item.value.mobile

      if (!mobile) return []
      const tab: PanelTab = { id: item.value.id, title: mobile.title }

      return [
        { key: panelKey(item.extension, item.value.id), extension: item.extension, tab, provider: item.value, mobile },
      ]
    }),
  )

  const sorted = (kinds: readonly string[]) =>
    entries()
      .filter((entry) => kinds.includes(entry.mobile.kind))
      .toSorted((a, b) => a.mobile.order - b.mobile.order)

  return {
    entries,
    tabs: createMemo(() => sorted(["tab"])),
    menu: createMemo(() => [...sorted(["menu"]), ...sorted(["drawer"])]),
    find: (key: string) => entries().find((entry) => entry.key === key),
  }
}

export type MobileViews = ReturnType<typeof createMobileViews>

/** The narrow-screen view switcher: the conversation, each tab view, and a More drawer with the other views. */
export function MobileViewTabs(props: {
  views: MobileViews
  region: Region
  current: string
  session: MountedSession
  screen: SessionScreen
  sidebar: PanelSidebar
  bottom?: boolean
  onSelect: (key: string) => void
}): JSX.Element {
  const language = useLanguage()

  const [store, setStore] = createStore<{
    open: boolean
    loaded: boolean
    drawer: string | undefined
  }>({
    open: false,
    loaded: false,
    drawer: undefined,
  })

  const drawer = createMemo(() => (store.drawer ? props.views.find(store.drawer) : undefined))

  const tab = createMemo(() =>
    props.current === "session" || props.views.tabs().some((entry) => entry.key === props.current)
      ? props.current
      : "more",
  )

  let menu: HTMLDivElement | undefined
  let trigger: HTMLButtonElement | undefined

  return (
    <div
      class="relative flex shrink-0 items-center before:pointer-events-none before:absolute before:inset-x-0 before:h-px before:bg-v2-border-border-base before:content-['']"
      classList={{ "before:top-0": props.bottom, "before:bottom-0": !props.bottom }}
      data-slot="session-mobile-view-navigation"
    >
      <Tabs value={tab()} variant="line" class="!h-auto min-w-0 flex-1" data-slot="session-mobile-view-tabs">
        <Tabs.List aria-label={language.t("session.view.select")} class="min-h-9 items-stretch gap-0 border-0">
          <Tabs.Trigger
            value="session"
            class="min-w-0 flex-1"
            classes={{ button: "h-full min-h-[var(--reddb-spatial-target-min)] w-full justify-center" }}
            onClick={() => props.onSelect("session")}
          >
            {language.t("session.tab.session")}
          </Tabs.Trigger>
          <For each={props.views.tabs()}>
            {(entry) => (
              <Tabs.Trigger
                value={entry.key}
                class="min-w-0 flex-1"
                classes={{ button: "h-full min-h-[var(--reddb-spatial-target-min)] w-full justify-center" }}
                onClick={() => props.onSelect(entry.key)}
              >
                {entry.mobile.title}
              </Tabs.Trigger>
            )}
          </For>
          <Show when={props.views.menu().length}>
            <Tabs.Trigger
              value="more"
              ref={(element: HTMLButtonElement) => {
                trigger = element
              }}
              class="min-w-0 flex-1"
              classes={{ button: "h-full min-h-[var(--reddb-spatial-target-min)] w-full justify-center" }}
              aria-haspopup="dialog"
              aria-expanded={store.open}
              onClick={() => setStore({ open: true, loaded: true, drawer: undefined })}
            >
              {language.t("session.tab.more")}
            </Tabs.Trigger>
          </Show>
        </Tabs.List>
      </Tabs>
      <Show when={store.loaded}>
        <Suspense>
          <MobilePanelDrawer
            title={drawer()?.mobile.title ?? language.t("common.moreOptions")}
            hideHeader
            open={store.open}
            onOpenChange={(open) => setStore("open", open)}
            initialFocus={() => menu}
            returnFocus={() => trigger}
          >
            <Show
              when={drawer()}
              keyed
              fallback={
                <div ref={menu} tabindex="-1" class="outline-none">
                  <Show when={store.open}>
                    <ReactView
                      component={PanelChoices}
                      props={{
                        language: sharedLanguage(language),
                        title: language.t("common.moreOptions"),
                        mobile: true,
                        items: props.views.menu().map((entry) => ({
                          value: entry.key,
                          label: entry.mobile.title,
                          icon: entry.mobile.icon,
                          drawer: entry.mobile.kind === "drawer",
                          selected: entry.mobile.kind === "menu" ? props.current === entry.key : undefined,
                          run: () => {
                            if (entry.mobile.kind === "drawer") {
                              setStore("drawer", entry.key)
                              return
                            }
                            props.onSelect(entry.key)
                            setStore("open", false)
                          },
                        })),
                      }}
                    />
                  </Show>
                </div>
              }
            >
              {(entry) => (
                <MobilePanel
                  entry={entry}
                  view={props.session}
                  screen={props.screen}
                  sidebar={props.sidebar}
                  visible={store.open}
                  open={() => props.region.openFor(entry.extension)}
                />
              )}
            </Show>
          </MobilePanelDrawer>
        </Suspense>
      </Show>
    </div>
  )
}
