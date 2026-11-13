import { createMemo, Show } from "solid-js"
import { useQuery } from "@tanstack/solid-query"
import type { MountedSession } from "@opencode/gui-extensions/sdk"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"

export function TaskActivityStrip(props: { session: MountedSession; open: () => void }) {
  const language = useLanguage()
  const root = createMemo(() => props.session.server.data.session.root(props.session.id))
  const graph = useQuery(() => ({
    queryKey: ["session-task-activity", props.session.server.id, root()],
    enabled: props.session.server.connected,
    queryFn: ({ signal }) => props.session.server.client.session.todo.graph({ sessionID: root() }, { signal }),
    retry: false,
    refetchInterval: props.session.server.connected ? 5000 : false,
  }))
  const activity = createMemo(() => {
    const tasks = graph.data?.tasks ?? []
    const nodes = graph.data?.nodes ?? []
    const family = props.session.server.data.session.family(root())
    const sessionWaits = family.filter(
      (id) =>
        props.session.server.data.session.permission.list(id)?.length ||
        props.session.server.data.session.form.list(id)?.length,
    ).length
    return {
      active: tasks.filter((task) => task.status === "in_progress").length,
      blocked: tasks.filter((task) => task.status === "blocked").length,
      waiting: nodes.filter((node) => node.waitingFor.length > 0).length + sessionWaits,
      subagents: family.filter(
        (id) => id !== root() && props.session.server.data.session.status(id) === "running",
      ).length,
    }
  })
  const visible = createMemo(() => Object.values(activity()).some((count) => count > 0))

  return (
    <Show when={visible()}>
      <button
        type="button"
        class="mx-2 mb-1 flex min-h-8 items-center gap-3 rounded-md border border-border-weak-base bg-background-base px-3 text-left text-12-regular text-ink-muted hover:bg-surface-raised-base"
        aria-label={language.t("agentTasks.openActivity")}
        onClick={props.open}
      >
        <Icon name="status" size="small" />
        <span class="font-medium text-foreground">{language.t("agentTasks.activity")}</span>
        <Show when={activity().active > 0}>
          <span>{language.t("agentTasks.activityActive", { count: activity().active })}</span>
        </Show>
        <Show when={activity().subagents > 0}>
          <span>{language.t("agentTasks.activitySubagents", { count: activity().subagents })}</span>
        </Show>
        <Show when={activity().waiting > 0}>
          <span>{language.t("agentTasks.activityWaiting", { count: activity().waiting })}</span>
        </Show>
        <Show when={activity().blocked > 0}>
          <span>{language.t("agentTasks.activityBlocked", { count: activity().blocked })}</span>
        </Show>
      </button>
    </Show>
  )
}
