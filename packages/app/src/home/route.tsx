import { ScrollView } from "@opencode/ui/scroll-view"
import { createHomeController } from "./model"
import { createHomeProjectsController } from "./projects/controller"
import { HomeProjects } from "./projects/region"
import { createHomeScrollController } from "./scroll"
import { createHomeSessionSearchController } from "./sessions/search"
import { createHomeSessionsController } from "./sessions/controller"
import { HomeSessions } from "./sessions/region"

export function Home() {
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const sessions = createHomeSessionsController(home)
  const search = createHomeSessionSearchController(home, sessions)
  const scroll = createHomeScrollController(sessions.data.groups)
  return (
    <div
      data-component="home"
      class={`
        mx-2 mb-[var(--shell-bottom-inset,8px)] mt-[var(--shell-top-inset,8px)] flex min-h-0 flex-1 self-stretch
        overflow-hidden rounded-lg bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]
      `}
    >
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <h1 class="sr-only">{projects.copy.language.t("home.title")}</h1>
        {/* Projects live in the sidemenu; Home keeps a compact scope picker for its session list. */}
        <div class="relative z-40 mx-auto flex w-full max-w-[60rem] shrink-0 px-3 pt-3 md:px-6 md:pt-6 lg:px-10">
          <HomeProjects projects={projects} scroll={scroll} dropdown />
        </div>
        <ScrollView
          class="min-h-0 flex-1 [container-type:size]"
          thumbContainer={scroll.viewport.thumbTrack()}
          thumbHoverTarget={scroll.viewport.hoverTarget()}
          viewportRef={scroll.viewport.setViewport}
          onScroll={(event) => scroll.viewport.update(event.currentTarget.scrollTop)}
          onWheel={scroll.viewport.containOuterWheel}
        >
          <div class="mx-auto flex min-h-full w-full max-w-[60rem] flex-col px-3 md:px-6 lg:px-10">
            <HomeSessions sessions={sessions} search={search} scroll={scroll} />
          </div>
        </ScrollView>
      </div>
    </div>
  )
}
