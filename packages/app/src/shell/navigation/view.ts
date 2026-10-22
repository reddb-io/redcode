import { sharedLanguage } from "@/runtime/react/language"
import { serverName, ServerConnection } from "@/runtime/server/registry"
import type { NavigationController } from "./controller"
import type { useCommand } from "@/shell/commands/command"
import type { useProjectMenuItems } from "@/runtime/extension/projects"
import type { usePlatform } from "@/runtime/platform/platform"
import { fileManagerApp } from "@/home/projects/file-manager"

/** Capture reactive services at their owning boundary; React only reads this snapshot. */
export function navigationView(
  navigation: NavigationController,
  command: ReturnType<typeof useCommand>,
  contributions: ReturnType<typeof useProjectMenuItems>,
  platform: ReturnType<typeof usePlatform>,
  labelled: boolean,
) {
  const tree = navigation.tree()
  const server = navigation.server()
  const name = serverName(server)
  return {
    language: sharedLanguage(navigation.language),
    mobile: navigation.mobile(),
    opened: navigation.panel.opened(),
    width: navigation.panel.width(),
    labelled,
    count: navigation.background().length,
    server,
    serverKey: server ? ServerConnection.key(server) : undefined,
    serverName: name,
    avatar: Array.from(name.replace(/^[^\p{L}\p{N}]+/u, ""))[0]?.toUpperCase() ?? "?",
    route: {
      home: navigation.route.home(),
      agents: navigation.route.agents(),
      settings: navigation.route.settings(),
    },
    keybinds: Object.fromEntries(
      ["home.toggle", "tab.new", "command.palette", "sidebar.toggle", "agents.open", "settings.open"].map((id) => [
        id,
        command.keybindParts(id),
      ]),
    ),
    current: { session: navigation.current.session(), project: navigation.current.project() },
    query: navigation.filter.value(),
    sections: Object.fromEntries(["pinned", "projects", "recents"].map((id) => [id, navigation.section.open(id)])),
    tree,
    projects: Object.fromEntries(
      tree.projects.map((item) => [
        item.key,
        {
          unseen: navigation.project.unseen(item.project),
          showingAll: navigation.project.showingAll(item.key),
        },
      ]),
    ),
    sessions: Object.fromEntries(
      [...tree.pinned, ...tree.projects.flatMap((item) => item.sessions), ...tree.recents].map(({ session }) => [
        session.id,
        {
          status: navigation.session.status(session.id),
          since: navigation.session.since(session.id),
          unread: navigation.session.unread(session.id),
          pinned: navigation.session.pinned(session.id),
        },
      ]),
    ),
    contributions: contributions(),
    canReveal: !!server && navigation.project.actions.canReveal(server),
    revealLabel: navigation.language.t(
      fileManagerApp(platform.platform === "desktop" ? (platform.os ?? "unknown") : "unknown").actionLabel,
    ),
  }
}

export type NavigationView = ReturnType<typeof navigationView>
