import { sharedMount } from "@/runtime/react/mount"
import { sharedSource } from "@/runtime/react/source"
import { sharedLanguage } from "@/runtime/react/language"
import { ReactView } from "@/runtime/react/view"
import { HomeView } from "./route.react"
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

  const source = sharedSource(() => sharedLanguage(projects.copy.language))
  const projectView = sharedMount(() => <HomeProjects projects={projects} dropdown />)
  const sessionView = sharedMount(() => <HomeSessions sessions={sessions} search={search} scroll={scroll} />)
  return (
    <ReactView
      component={HomeView}
      props={{
        source,
        projects: projectView,
        sessions: sessionView,
        scroll,
        bindViewport: (element) => {
          if (element) scroll.viewport.setViewport(element)
        },
      }}
    />
  )
}
