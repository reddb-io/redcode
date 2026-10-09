import {
  ErrorBoundary,
  Show,
  Match,
  Switch,
  createMemo,
  createEffect,
  on,
  onCleanup,
  untrack,
  type Accessor,
} from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { ResizeHandle } from "@opencode/ui/resize-handle"
import { Slot, type BackgroundTask, type MountedSession, type SessionScreen } from "@opencode/gui-extensions/sdk"
import { MessageTimeline } from "@/session/timeline/message-timeline"
import { ComposerDropzone } from "@/composer/dropzone"
import { useSettings } from "@/settings/model"
import type { SessionModel } from "@/session/model"
import { SESSION_PANEL_WIDTH_MIN } from "@/session/session-panel-width"
import { SessionPanelFrame } from "@/session/session-frame"
import { useExtensionHost } from "@/runtime/extension/host"
import { ExtensionLinks } from "@/runtime/extension/render"
import {
  createDockEntry,
  createPanelSidebar,
  createRegion,
  DockRegion,
  MobilePanel,
} from "@/runtime/extension/panels"
import { createWorkbench } from "@/runtime/extension/workbench-store"
import { createMobileViews, MobileViewTabs } from "@/runtime/extension/mobile"
import { useExtensionAttachment } from "@/runtime/extension/host-apis"
import { createMountedSession } from "@/runtime/extension/mounted-session"
import { useUsageExceededDialogs } from "./usage-exceeded-dialogs"
import { SessionErrorFallback } from "./route-error"
import { createSessionScreenLayout } from "./screen-layout"
import { SideRegion } from "@/runtime/extension/side-region"
import { createSessionTimelineInteraction } from "./timeline/interaction"
import { createTimelineSearchController } from "./timeline/search-controller"
import { TimelineSearchBar } from "./timeline/search-bar"
import { ActiveSessionComposerRegion, createActiveSessionRegion } from "./composer/region"
import { SessionIdentityHeader } from "./session-identity-header"
import { SessionPanelToggles } from "./header/session-header-actions"
import { SessionRunningMenu } from "./header/session-running-menu"
import { createAnimatedPresence } from "@/runtime/animated-presence"
import { createTimelineCache } from "./timeline/cache"

export function SessionScreenView(props: { session: SessionModel }) {
  // The timeline cache captures its owner when created, so link handling must be provided above it.
  const mounted = createMountedSession(props.session)

  return (
    <ExtensionLinks session={mounted.view()}>
      <SessionScreenContent
        session={props.session}
        screen={mounted.screen}
        view={mounted.view}
        bindBackground={mounted.bindBackground}
      />
    </ExtensionLinks>
  )
}

function SessionScreenContent(props: {
  session: SessionModel
  /** One object per routed session; renders receive each through a reactive prop instead of remounting. */
  view: Accessor<MountedSession>
  screen: SessionScreen
  bindBackground: (tasks: () => readonly BackgroundTask[]) => void
}) {
  const session = props.session
  const host = useExtensionHost()
  const attachment = useExtensionAttachment()
  const settings = useSettings()
  const isDesktop = session.isDesktop
  const bottomMobileTabs = () => settings.general.mobileTitlebarPosition() === "bottom"
  const sidebar = createPanelSidebar()
  const workbench = createWorkbench(session.layout.tabKey)
  const dockEntry = createDockEntry(props.view, props.screen)
  // The dock is a workbench tab while the terminal sits beside the timeline; below it, it keeps its own region.
  const workbenchDock = createMemo(() =>
    isDesktop() && settings.general.terminalPlacement() === "side" ? dockEntry() : undefined,
  )

  const region = createRegion({
    region: "side",
    view: props.view,
    screen: props.screen,
    tabs: session.layout.tabs,
    workbench,
    sideOpen: () => session.layout.view().side.opened(),
    dock: {
      entry: () => (session.layout.view().dock.opened() ? workbenchDock() : undefined),
      close: () => session.layout.view().dock.close(),
    },
  })

  onCleanup(attachment.region(region))
  const mobile = createMobileViews()

  const screen = createSessionScreenLayout(session, {
    wide: region.wide,
    sidebar: () => host.items(Slot).some((item) => item.value.at === "session.panel.sidebar"),
    expanded: () => workbench.state().expanded,
  })

  const timeline = createSessionTimelineInteraction(session)

  const timelineSearch = createTimelineSearchController({
    sessionID: session.identity.sessionID,
    scrollRef: timeline.scroller,
    revealMessage: timeline.actions.revealMessage,
    pauseAutoScroll: timeline.view.unpin,
  })

  const messagesReady = timeline.ready

  const [store, setStore] = createStore({
    bottomDockCached: false,
    sideWidthMotion: false,
    timelineScrollbarHidden: false,
    sideColumnPresent: false,
    sideDockCached: false,
    togglesWidth: 28,
    mobileDockCached: false,
  })

  const [elements, setElements] = createStore<{
    side?: HTMLDivElement
    bottomDock?: HTMLDivElement
  }>({})

  const sideVisible = createMemo(() => isDesktop() && screen.side.layout().visible)
  const sideDockVisible = createMemo(() => isDesktop() && screen.dock.side() && screen.dock.open())
  const bottomDockVisible = createMemo(() => isDesktop() && screen.dock.open() && screen.dock.bottom())

  const sidePresence = createAnimatedPresence(
    () => sideVisible() || undefined,
    () => elements.side ?? null,
    session.layout.tabKey,
  )

  const bottomDockPresence = createAnimatedPresence(
    () => bottomDockVisible() || undefined,
    () => elements.bottomDock ?? null,
    session.layout.tabKey,
  )

  const trackSideWidthMotion = (event: TransitionEvent) => {
    if (event.currentTarget !== event.target || event.propertyName !== "width") return
    setStore("sideWidthMotion", event.type === "transitionrun")
  }

  const hideTimelineScrollbar = () => setStore("timelineScrollbarHidden", true)

  const revealTimelineScrollbar = (event: Event) => {
    if (!store.timelineScrollbarHidden || store.sideWidthMotion) return

    if (!(event.target instanceof Element) || !event.target.closest('[data-slot="session-timeline-scroll"]')) return
    setStore("timelineScrollbarHidden", false)
  }

  createEffect(() => {
    // The workbench keeps the dock's terminals mounted once opened, as the bottom dock does.
    if (sideDockVisible()) setStore("sideDockCached", true)

    if (bottomDockVisible()) setStore("bottomDockCached", true)
  })
  createEffect(() => {
    if (!isDesktop() || screen.dock.bottom()) setStore("sideDockCached", false)

    if (isDesktop() && screen.dock.side()) setStore("bottomDockCached", false)
  })
  createEffect(() => {
    if (screen.side.column.open()) setStore("sideColumnPresent", true)

    // A column that closes while the file tree stays has no exit animation to wait for.
    if (!screen.side.column.open() && sideVisible()) setStore("sideColumnPresent", false)
  })

  // The dock's narrow-screen view follows the dock's open state; other views are a selection.
  const dockView = createMemo(() => mobile.entries().find((entry) => entry.provider.region === "dock"))

  const mobileView = createMemo(() =>
    screen.dock.open() ? (dockView()?.key ?? "session") : attachment.mobile.current(),
  )

  const mobileEntry = createMemo(() => {
    const key = mobileView()

    return key === "session" ? undefined : mobile.find(key)
  })

  const conversationVisible = createMemo(() => isDesktop() || mobileView() === "session")
  createEffect(() => {
    if (!isDesktop() && screen.dock.open()) setStore("mobileDockCached", true)
  })

  const selectMobile = (key: string) => {
    if (key === dockView()?.key) {
      session.layout.view().dock.open()

      return
    }

    attachment.mobile.select(key)
    session.layout.view().dock.close()
  }

  const composer = createActiveSessionRegion({
    session,
    screen,
    timeline,
    region,
    visible: conversationVisible,
  })

  props.bindBackground(composer.requests.background.tasks)
  useUsageExceededDialogs()

  const sessionErrorFallback = (cause: unknown, reset: () => void) => {
    createEffect(on(session.identity.sessionKey, reset, { defer: true }))

    return <SessionErrorFallback error={cause} sessionID={session.identity.params.id} />
  }

  const timelineView = createTimelineCache(
    session,
    (source, active) => {
      // A cached timeline keeps its own session's latest object while another session is routed.
      const own = createMemo<MountedSession>((previous) => {
        const view = props.view()

        return view.id === source.identity.sessionID() ? view : previous
      }, untrack(props.view))

      return (
        <MessageTimeline
          active={active()}
          hideHeader={!isDesktop()}
          session={source}
          view={own()}
          screen={props.screen}
          background={composer.requests.background}
          actions={composer.actions.timeline}
          scroll={timeline.scroll}
          onResumeScroll={timeline.actions.resume}
          setScrollRef={timeline.view.setScrollRef}
          onScheduleScrollState={timeline.view.scheduleScrollState}
          onPin={timeline.view.pin}
          onUnpin={timeline.view.unpin}
          onUserScroll={timeline.view.markUserScroll}
          onHistoryScroll={timeline.view.onHistoryScroll}
          onSelectionInteraction={timeline.view.selectionInteraction}
          pinned={timeline.view.pinned()}
          centered={screen.centered()}
          reserveReviewToggle
          setContentRef={timeline.view.setContentRef}
          anchor={timeline.view.anchor}
          setRevealMessage={timeline.view.setRevealMessage}
          reveal={timeline.view.reveal}
          setScrollToEnd={timeline.view.setScrollToEnd}
          search={
            <Show when={active()}>
              <TimelineSearchBar controller={timelineSearch} />
            </Show>
          }
        />
      )
    },
    () => conversationVisible() && messagesReady(),
  )

  const mobileTabs = () => (
    <Show when={session.identity.sessionKey()} keyed>
      {(_key) => (
        <MobileViewTabs
          bottom={bottomMobileTabs()}
          screen={props.screen}
          views={mobile}
          region={region}
          current={mobileView()}
          session={props.view()}
          sidebar={sidebar}
          onSelect={selectMobile}
        />
      )}
    </Show>
  )

  const sessionPanelContent = () => (
    <>
      <ComposerDropzone
        active={composer.drop.active()}
        input={composer.drop.input()}
        identity={session.layout.tabKey}
      />
      <Show when={!isDesktop() && !!session.identity.params.id && !bottomMobileTabs()}>{mobileTabs()}</Show>
      {/* Surface query errors without suspending session metadata while messages load. */}
      <Show when={timeline.resource.error}>
        {(error) => {
          throw error()
        }}
      </Show>
      <div class="relative flex-1 min-h-0 overflow-hidden">
        <Show when={!isDesktop() && store.mobileDockCached}>
          <div class="absolute inset-0" classList={{ invisible: mobileView() !== dockView()?.key }}>
            <DockRegion
              view={props.view()}
              screen={props.screen}
              sidebar={sidebar}
              fill
              embedded
              present
              contentHeight="100%"
            />
          </div>
        </Show>
        <Switch>
          <Match when={!isDesktop() && mobileEntry()?.provider.region === "dock"}>
            <></>
          </Match>
          <Match when={!isDesktop() && session.identity.params.id ? mobileEntry() : undefined}>
            {(entry) => (
              <MobilePanel
                screen={props.screen}
                entry={entry()}
                view={props.view()}
                sidebar={sidebar}
                visible
                open={() => region.openFor(entry().extension)}
              />
            )}
          </Match>
          <Match when={session.identity.params.id}>
            <Show when={isDesktop() && !messagesReady()}>
              <SessionIdentityHeader sessionID={session.identity.params.id ?? ""} session={session.data.info()}>
                <SessionRunningMenu
                  sessionID={session.identity.params.id}
                  owner={composer.requests.background.running.sessionID()}
                  blocking={composer.requests.background.running.blocking()}
                  tasks={composer.requests.background.running.tasks()}
                  title={session.data.parentID() ? session.data.info()?.title : undefined}
                />
              </SessionIdentityHeader>
            </Show>
            <Show when={messagesReady() && session.identity.params.id}>{timelineView()}</Show>
          </Match>
        </Switch>
      </div>

      <Show when={composer.active()} keyed>
        {(model) => (
          <ActiveSessionComposerRegion session={session} model={model} suggestionBoundary={timeline.scroller} />
        )}
      </Show>
      <Show when={!isDesktop() && !!session.identity.params.id && bottomMobileTabs()}>{mobileTabs()}</Show>
    </>
  )

  return (
    <>
      <div class="flex-1 min-h-0 flex flex-col gap-2 px-[var(--shell-inline-inset,8px)] pb-[var(--shell-bottom-inset,8px)] pt-[var(--shell-top-inset,8px)]">
        <div ref={screen.panel.ref} class="relative flex-1 min-h-0 flex flex-col md:flex-row gap-2">
          <div
            classList={{
              "@container relative z-10 min-w-0 shrink-0 flex flex-col min-h-0 h-full flex-1 md:flex-none transition-[width]": true,
              "duration-[240ms] ease-[cubic-bezier(0.4,0,0.2,1)] will-change-[width] motion-reduce:transition-none":
                !screen.size.active() && sidePresence.animate(),
              "transition-none": screen.size.active() || !sidePresence.animate(),
              // Full width: the conversation gives the column its width and the gap beside it.
              "-me-2 invisible": screen.expanded(),
            }}
            inert={screen.expanded() || undefined}
            data-slot="session-chat-panel"
            data-width-animating={store.sideWidthMotion}
            data-scrollbar-hidden={store.timelineScrollbarHidden || store.sideWidthMotion}
            onPointerMove={revealTimelineScrollbar}
            onPointerDown={revealTimelineScrollbar}
            onWheel={revealTimelineScrollbar}
            onKeyDown={revealTimelineScrollbar}
            onTransitionRun={trackSideWidthMotion}
            onTransitionEnd={trackSideWidthMotion}
            onTransitionCancel={trackSideWidthMotion}
            style={{
              width: screen.panel.width(),
              "--session-header-toggles-width": `${store.togglesWidth}px`,
            }}
          >
            <Show when={!!session.identity.params.id}>
              <SessionPanelFrame raised>
                <ErrorBoundary fallback={sessionErrorFallback}>{sessionPanelContent()}</ErrorBoundary>
              </SessionPanelFrame>
            </Show>
            {/* The panel toggles sit at the end of the session header row, which reserves their width. */}
            <Show when={isDesktop() && messagesReady() && session.identity.params.id}>
              <div
                class="absolute end-3 top-0 z-30 h-12 flex items-center"
                data-slot="session-panel-toggles"
                ref={(element) =>
                  createResizeObserver(element, ({ width }) => setStore("togglesWidth", Math.ceil(width)))
                }
                onPointerDown={hideTimelineScrollbar}
                onClick={hideTimelineScrollbar}
              >
                <SessionPanelToggles region={region} dock={workbenchDock()?.key ?? dockEntry()?.key} />
              </div>
            </Show>

            <Show when={screen.panel.resizable()}>
              <div onPointerDown={() => screen.size.start()}>
                <ResizeHandle
                  class="-end-1"
                  direction="horizontal"
                  size={screen.panel.resizedWidth()}
                  min={SESSION_PANEL_WIDTH_MIN}
                  max={screen.panel.max()}
                  onResize={(width) => {
                    screen.size.touch()
                    session.layout.view().session.resize(width)
                  }}
                />
              </div>
            </Show>
          </div>

          <Show when={sidePresence.present() || store.sideColumnPresent || store.sideDockCached}>
            <div
              ref={(element) => setElements("side", element)}
              data-slot="session-side-panel-presence"
              data-opened={sidePresence.animate() ? sidePresence.show() : undefined}
              onAnimationEnd={(event) => {
                if (event.currentTarget !== event.target) return

                if (event.animationName === "side-region-presence-out" && !screen.side.column.open())
                  setStore("sideColumnPresent", false)
              }}
              classList={{
                "relative z-0 min-w-0 h-full flex-1 overflow-visible": sidePresence.present(),
                "absolute inset-y-0 end-0 z-0 w-0 invisible pointer-events-none overflow-visible":
                  !sidePresence.present(),
              }}
            >
              <div
                data-slot="session-side-panel-content"
                class="absolute inset-y-0 start-0 size-full flex"
                style={{ "--session-side-content-width": screen.side.contentWidth() }}
              >
                <SideRegion
                  screen={props.screen}
                  view={props.view()}
                  region={region}
                  sidebar={sidebar}
                  workbench={workbench}
                  dock={workbenchDock()}
                  fileTree={screen.files.open()}
                  present={store.sideColumnPresent}
                  size={screen.size}
                />
              </div>
            </div>
          </Show>
        </div>

        <Show when={isDesktop() && (bottomDockPresence.present() || store.bottomDockCached)}>
          <div
            ref={(element) => setElements("bottomDock", element)}
            data-slot="terminal-panel-presence"
            data-opened={bottomDockPresence.animate() ? bottomDockPresence.show() : undefined}
            classList={{
              hidden: !bottomDockPresence.present(),
              "relative min-h-0 shrink-0": isDesktop(),
            }}
          >
            <Show when={isDesktop()}>
              <div class="absolute z-10 -top-1 left-0 right-0 h-2" onPointerDown={() => screen.size.start()}>
                <ResizeHandle
                  class="!relative !inset-auto !h-full !w-full !transform-none"
                  direction="vertical"
                  size={session.layout.view().dock.height()}
                  min={100}
                  max={typeof window === "undefined" ? 600 : window.innerHeight * 0.6}
                  collapseThreshold={50}
                  onResize={(height) => {
                    screen.size.touch()
                    session.layout.view().dock.resize(height)
                  }}
                  onCollapse={() => session.layout.view().dock.close()}
                />
              </div>
            </Show>
            <DockRegion
              screen={props.screen}
              view={props.view()}
              sidebar={sidebar}
              stacked={isDesktop()}
              present={store.bottomDockCached}
              animate={bottomDockPresence.animate()}
            />
          </div>
        </Show>
      </div>
    </>
  )
}
