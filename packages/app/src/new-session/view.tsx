import { useDialog } from "@opencode/ui/context/dialog"
import { createMemo } from "solid-js"
import { Schema } from "effect"
import { Composer } from "@/composer/composer"
import { createDropzoneServices } from "@/composer/dropzone"
import type { ComposerModel } from "@/composer/model"
import { createGitStatusSource, createWorkspaceSelectorServices } from "@/new-session/workspace/selector"
import { createProjectSelectorServices, type PromptProjectController } from "@/new-session/project/selector"
import { useLanguage } from "@/runtime/i18n/language"
import { sharedLanguage } from "@/runtime/react/language"
import { sharedSource } from "@/runtime/react/source"
import { sharedMount } from "@/runtime/react/mount"
import { ReactView } from "@/runtime/react/view"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useProviders } from "@/providers/catalog/providers"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import type { NewSessionWorkspaceController } from "./workspace/controller"
import { NewSessionNativeView } from "./view.react"

const providerTipDismissalDuration = 30 * 24 * 60 * 60 * 1000

export const WorkspaceOnboardingSchema = Persistence.struct({
  used: Schema.Boolean,
})

export const ProviderTipSchema = Persistence.struct({
  dismissedAt: Schema.Finite,
})

export const WorkspaceTipSchema = ProviderTipSchema

export function createNewSessionViewServices(props: {
  composer: ComposerModel
  project: PromptProjectController
  workspace: NewSessionWorkspaceController
}) {
  const [onboarding, setOnboarding, , onboardingReady] = persisted(
    Persist.global("workspace-onboarding"),
    WorkspaceOnboardingSchema,
    { used: false },
  )

  const select = (value: string) => {
    props.workspace.selection.set(value)

    if (value !== "main") setOnboarding("used", true)
  }

  return {
    snapshot: sharedSource(() => ({
      empty: props.project.empty(),
      project: !!props.project.selected(),
      workspace: props.workspace.bar.visible(),
    })),
    composer: sharedMount(() => <Composer model={props.composer} />),
    dropzone: createDropzoneServices({
      get active() {
        return props.composer.state.drag === "active"
      },
      get input() {
        return props.composer.model.selection.current()?.capabilities.input
      },
    }),
    project: createProjectSelectorServices({ controller: props.project, placement: "bottom" }),
    workspace: createWorkspaceSelectorServices({
      get value() {
        return props.workspace.selection.value()
      },
      get projectRoot() {
        return props.workspace.project.root()
      },
      get workspaces() {
        return props.workspace.project.workspaces()
      },
      get branches() {
        return props.workspace.project.branches()
      },
      get branch() {
        return props.workspace.bar.branch()
      },
      get onboarding() {
        return onboardingReady() && !onboarding.used
      },
      onChange: select,
      onCreate: props.workspace.selection.create,
      onSearch: props.workspace.project.searchBranches,
      onDone: props.composer.restoreFocus,
      onViewAll: props.workspace.project.openAll,
    }),
    git: createGitStatusSource({
      get branch() {
        return props.workspace.bar.branch()
      },
      get noGit() {
        return !props.workspace.project.git()
      },
      class: "ms-1",
    }),
    tips: createNewSessionTipsServices({
      get selection() {
        return props.composer.model.selection
      },
      onDone: props.composer.restoreFocus,
      get workspaceEligible() {
        return (
          !!props.project.selected() &&
          props.workspace.bar.visible() &&
          props.workspace.selection.value() !== "create" &&
          props.workspace.project.managed() === 0
        )
      },
      onWorkspace: () => select("create"),
    }),
  }
}

export function NewSessionView(props: Parameters<typeof createNewSessionViewServices>[0]) {
  const services = createNewSessionViewServices(props)
  return <ReactView component={NewSessionNativeView} props={{ services }} />
}

export function createNewSessionTipsServices(props: {
  selection: ComposerModel["model"]["selection"]
  onDone: () => void
  workspaceEligible: boolean
  onWorkspace: () => void
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const sdk = useWorkspaceLocation()
  const providers = useProviders(() => sdk().directory)

  const [providerState, setProviderState, , providerReady] = persisted(
    Persist.global("new-session.provider-tip"),
    ProviderTipSchema,
    { dismissedAt: 0 },
  )

  const [workspaceState, setWorkspaceState, , workspaceReady] = persisted(
    Persist.global("new-session.workspace-tip"),
    WorkspaceTipSchema,
    { dismissedAt: 0 },
  )

  const workspaceVisible = createMemo(
    () =>
      props.workspaceEligible &&
      workspaceReady() &&
      Date.now() - workspaceState.dismissedAt >= providerTipDismissalDuration,
  )

  const providerVisible = createMemo(
    () =>
      providerReady() &&
      providers.anyConnection() === false &&
      Date.now() - providerState.dismissedAt >= providerTipDismissalDuration,
  )

  const tip = createMemo<"workspace" | "provider" | undefined>(() => {
    if (providerVisible()) return "provider"

    if (workspaceVisible()) return "workspace"
  })

  const open = () => {
    const current = tip()

    if (!current) return

    if (current === "workspace") {
      setWorkspaceState("dismissedAt", Date.now())
      props.onWorkspace()

      return
    }

    void connect()
  }

  async function connect() {
    const { DialogConnectProvider } = await import("@/providers/connect/dialog")
    void dialog.show(() => (
      <DialogConnectProvider directory={sdk().directory} selection={props.selection} onDone={props.onDone} />
    ))
  }

  const dismiss = () => {
    const current = tip()

    if (!current) return

    if (current === "workspace") {
      setWorkspaceState("dismissedAt", Date.now())

      return
    }

    setProviderState("dismissedAt", Date.now())
  }

  return {
    snapshot: sharedSource(() => ({
      language: sharedLanguage(language),
      visible: tip() !== undefined,
      workspace: tip() === "workspace",
    })),
    open,
    dismiss,
  }
}
