import { getFilename, sameDirectory } from "@opencode/util/path"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { sharedLanguage } from "@/runtime/react/language"
import { sharedSource } from "@/runtime/react/source"
import { ReactView } from "@/runtime/react/view"
import { WorkspaceSelector, GitStatus } from "./selector.react"

type WorkspaceSelectorProps = {
  value: string
  projectRoot: string
  workspaces: string[]
  branches: string[]
  branch?: string
  onboarding?: boolean
  variant?: "inline" | "summary"
  onChange: (value: string) => void
  onCreate: (branch: string) => void
  onSearch: (search: string) => void
  onDone?: () => void
  onViewAll: () => void
}

export function createWorkspaceSelectorServices(props: WorkspaceSelectorProps) {
  const language = useLanguage()
  const [state, setState] = createStore({ branches: false })
  return {
    snapshot: sharedSource(() => {
      const selected = sameDirectory(props.value, props.projectRoot) ? "main" : props.value
      const summary = props.variant === "summary"
      return {
        language: sharedLanguage(language),
        direction: language.direction(),
        selected,
        summary,
        workspaces: props.workspaces.map((directory) => ({ directory, name: getFilename(directory) })),
        branches: state.branches ? [...props.branches] : [],
        branch: props.branch,
        onboarding: !!props.onboarding,
        label:
          selected === "main"
            ? language.t(summary ? "session.new.workspace.local" : "session.new.workspace.triggerLocal")
            : props.value === "create"
              ? language.t("workspace.new")
              : getFilename(props.value),
      }
    }),
    select: (value: string) => props.onChange(value),
    create: (branch: string) => props.onCreate(branch),
    search: (search: string) => props.onSearch(search),
    branchOpen: (open: boolean) => setState("branches", open),
    done: () => props.onDone?.(),
    viewAll: () => props.onViewAll(),
  }
}

export function PromptWorkspaceSelector(props: WorkspaceSelectorProps) {
  const services = createWorkspaceSelectorServices(props)
  return <ReactView component={WorkspaceSelector} props={{ services }} />
}

export function createGitStatusSource(props: { branch?: string; noGit?: boolean; from?: boolean; class?: string }) {
  const language = useLanguage()
  return sharedSource(() => ({
    label: props.noGit
      ? language.t("session.new.git.none")
      : props.branch
        ? props.from
          ? language.t("session.new.workspace.fromBranch", { branch: props.branch })
          : props.branch
        : undefined,
    icon: props.noGit ? "monitor" : props.from ? "branch-out" : "branch",
    className: props.class,
  }))
}

export function PromptGitStatus(props: Parameters<typeof createGitStatusSource>[0]) {
  const source = createGitStatusSource(props)
  return <ReactView component={GitStatus} props={{ source }} />
}
