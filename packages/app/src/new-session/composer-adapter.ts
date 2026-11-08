import { Predicate } from "effect"
import { base64Encode } from "@opencode/util/encode"
import { Session } from "@opencode/schema/session"
import { startTransition } from "solid-js"
import type { ComposerSelection, NewSessionComposerAdapter } from "@/composer/adapter"
import { useComposerState } from "@/composer/persistence"
import { createComposerReasoning } from "@/composer/reasoning/state"
import { createComposerControls, createComposerModelSelection } from "@/composer/selection"
import { createComposerProjectControls } from "./project/controller"
import { useLanguage } from "@/runtime/i18n/language"
import { useLocal } from "@/providers/models/selection"
import { useData, useServer } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useTabs } from "@/shell/tabs/tabs"
import { createWorktree } from "@/workspaces/create"
import { showToast } from "@/shell/notifications/toast"
import type { DraftMcpControls } from "./mcp"
import {
  createNewSessionPhaseRunner,
  NEW_SESSION_CREATE_TIMEOUT_MS,
  NEW_SESSION_MCP_TIMEOUT_MS,
  NEW_SESSION_WORKTREE_TIMEOUT_MS,
} from "./phase-runner"

export function createNewSessionComposerAdapter(props: {
  draftID: string
  worktree: () => string
  root: () => string
  branch: () => string | undefined
  submitted: () => void
  mcp: DraftMcpControls
}) {
  const prompt = useComposerState()
  const state = prompt.capture()
  const local = useLocal()
  const data = useData()
  const server = useServer()
  const serverSDK = useServerSDK()
  const tabs = useTabs()
  const language = useLanguage()
  const model = createComposerModelSelection({ agent: () => local.agent.current() })
  const controls = createComposerControls({ model })
  // The server scopes a reasoning mode to an existing session, so a draft's choice waits for creation.
  const reasoning = createComposerReasoning({ session: () => undefined })

  const adapter: NewSessionComposerAdapter = {
    kind: "new-session",
    state,
    ready: prompt.ready,
    controls,
    reasoning,
    working: () => false,
    submitted: props.submitted,
    async start(selection, submission, message) {
      const phases = createNewSessionPhaseRunner()
      const draftID = props.draftID
      const projectDirectory = props.root()
      const worktree = props.worktree()
      const branch = props.branch()
      const mcp = props.mcp.capture()
      const id = Session.ID.create()

      const pending =
        worktree === "create"
          ? tabs.prepareSession(draftID, { server: server.key, sessionId: id }, { message, selection })
          : undefined

      const directoryRequest = Promise.resolve().then(async () => {
        await pending?.ready

        return resolveSessionDirectory({
          projectDirectory,
          worktree,
          branch,
          data,
          serverSDK,
          language,
        })
      })

      const sessionDirectory = await (worktree === "create"
        ? phases.run("worktree", directoryRequest, NEW_SESSION_WORKTREE_TIMEOUT_MS)
        : directoryRequest
      ).catch((error) => {
        showToast({
          variant: "error",
          title: language.t("prompt.toast.worktreeCreateFailed.title"),
          description: errorMessage(language, error),
        })

        return undefined
      })

      if (!sessionDirectory) {
        await pending?.rollback()

        return
      }

      const rollback = async () => {
        if (!pending) return
        data.project.invalidate()
        await data.project.sync().catch(() => undefined)
        await pending.rollback(sessionDirectory)
      }

      const mcpReady = await phases
        .run("mcp", props.mcp.prepare(sessionDirectory, mcp), NEW_SESSION_MCP_TIMEOUT_MS)
        .catch((error) => {
          showToast({
            variant: "error",
            title: language.t("session.summary.mcp.prepareFailed"),
            description: errorMessage(language, error),
          })

          return false
        })

      if (!mcpReady) {
        await rollback()

        if (pending) props.mcp.remember(sessionDirectory, mcp)

        return
      }

      const created = data.session.create({
        id,
        agent: selection.agent,
        model: {
          id: selection.model.modelID,
          providerID: selection.model.providerID,
          connection: selection.model.connection,
          variant: selection.variant,
        },
        location: { directory: sessionDirectory },
      })

      const request = phases.run("session", created.request, NEW_SESSION_CREATE_TIMEOUT_MS, () =>
        data.session.remove(created.id).catch(() => undefined),
      )
      const creation = request.then(
        () => ({ ok: true as const }),
        (error) => {
          showToast({
            title: language.t("prompt.toast.sessionCreateFailed.title"),
            description: errorMessage(language, error),
          })

          return { ok: false as const, error }
        },
      )

      if (pending && !(await creation).ok) {
        await rollback()

        return
      }

      // Apply the chosen mode before admitting the first prompt. Failure leaves the prompt unsent and recoverable.
      const reasoningApplied = creation.then((result) => (result.ok ? reasoning.apply(created.id) : undefined))

      if (reasoning.override() !== "default") {
        try {
          await reasoningApplied
        } catch (error) {
          showToast({
            variant: "error",
            title: language.t("composer.reasoning.failed"),
            description: errorMessage(language, error),
          })
          await rollback()

          return
        }
      }

      const afterCreation = async <T>(run: () => Promise<T>) => {
        const result = await creation

        if (!result.ok) throw result.error
        await reasoningApplied

        return run()
      }

      const cleanupReady = startTransition(() => {
        if (!pending) tabs.updateDraft(draftID, { worktree: undefined, branch: undefined })
        local.session.promote(sessionDirectory, created.id, {
          agent: selection.agent,
          model: selection.model,
          variant: selection.variant ?? null,
          choices: model.remembered(),
        })

        if (!pending) tabs.promoteDraft(draftID, { server: server.key, sessionId: created.id })
        submission.retarget(
          prompt.capture(
            { dir: base64Encode(sessionDirectory), id: created.id },
            { server: server.key, scope: serverSDK.scope },
          ),
          { preserveDraft: !!pending },
        )
      })

      return {
        cleanupReady,
        complete: pending ? () => pending.complete(submission.target()) : undefined,
        session: {
          id: created.id,
          directory: sessionDirectory,
          handoff: server.ctx.handoff.forSession(created.id),
          api: {
            command: (input) => afterCreation(() => serverSDK.api.session.command(input)),
            shell: (input) => afterCreation(() => serverSDK.api.session.shell(input)),
            switchAgent: (input) => afterCreation(() => serverSDK.api.session.switchAgent(input)),
            switchModel: (input) => afterCreation(() => serverSDK.api.session.switchModel(input)),
            revert: { commit: (input) => afterCreation(() => serverSDK.api.session.revert.commit(input)) },
          },
          file: serverSDK.api.file,
          data: {
            location: data.location,
            session: {
              setStatus: data.session.setStatus,
              prompt: (input) =>
                data.session.prompt({
                  ...input,
                  gate: Promise.all([input.gate, afterCreation(async () => undefined)]),
                }),
            },
          },
          current: () => data.session.get(created.id),
          admitted: (messageID) =>
            data.session.input.has(created.id, messageID) || !!data.session.message.get(created.id, messageID),
        },
      }
    },
  }

  let goalSession: { id: string; directory: string; selection: ComposerSelection; identity: string } | undefined
  return {
    adapter,
    project: createComposerProjectControls({ draftId: props.draftID, worktree: props.worktree }),
    model,
    ready: prompt.ready,
    async startGoal(objective: string) {
      const selected = controls()
      const selectedModel = selected.model.selection.current()
      const agent = selected.agents.current
      if (!selectedModel || !agent) throw new Error(language.t("goal.selectionRequired"))
      const selection = {
        agent,
        model: {
          providerID: selectedModel.provider.id,
          modelID: selectedModel.id,
          connection: selectedModel.connection,
        },
        variant: selected.model.selection.variant.current(),
      }
      const projectDirectory = props.root()
      const identity = JSON.stringify([projectDirectory, props.worktree(), props.branch(), selection])
      if (goalSession?.identity !== identity) goalSession = undefined
      if (!goalSession) {
        const phases = createNewSessionPhaseRunner()
        const worktree = props.worktree()
        const directoryRequest = resolveSessionDirectory({
          projectDirectory,
          worktree,
          branch: props.branch(),
          data,
          serverSDK,
          language,
        })
        const sessionDirectory = await (worktree === "create"
          ? phases.run("worktree", directoryRequest, NEW_SESSION_WORKTREE_TIMEOUT_MS)
          : directoryRequest)
        if (!sessionDirectory) throw new Error(language.t("goal.workspaceFailed"))
        if (
          !(await phases.run(
            "mcp",
            props.mcp.prepare(sessionDirectory, props.mcp.capture()),
            NEW_SESSION_MCP_TIMEOUT_MS,
          ))
        )
          throw new Error(language.t("goal.workspaceFailed"))
        const created = data.session.create({
          id: Session.ID.create(),
          agent,
          model: {
            id: selection.model.modelID,
            providerID: selection.model.providerID,
            connection: selection.model.connection,
            variant: selection.variant,
          },
          location: { directory: sessionDirectory },
        })
        await phases.run("session", created.request, NEW_SESSION_CREATE_TIMEOUT_MS, () =>
          data.session.remove(created.id).catch(() => undefined),
        )
        goalSession = { id: created.id, directory: sessionDirectory, selection, identity }
      }
      await reasoning.apply(goalSession.id)
      await serverSDK.api.session.goal.start({
        sessionID: goalSession.id,
        objective,
        agent: goalSession.selection.agent,
      })
      props.submitted()
      local.session.promote(goalSession.directory, goalSession.id, {
        agent: goalSession.selection.agent,
        model: goalSession.selection.model,
        variant: goalSession.selection.variant ?? null,
        choices: model.remembered(),
      })
      const target = prompt.capture(
        { dir: base64Encode(goalSession.directory), id: goalSession.id },
        { server: server.key, scope: serverSDK.scope },
      )
      target.set(state.current(), state.cursor())
      target.context.replace(state.context.items())
      tabs.updateDraft(props.draftID, { worktree: undefined, branch: undefined })
      tabs.promoteDraft(props.draftID, { server: server.key, sessionId: goalSession.id })
    },
  }
}

async function resolveSessionDirectory(input: {
  projectDirectory: string
  worktree: string
  branch?: string
  data: ReturnType<typeof useData>
  serverSDK: ReturnType<typeof useServerSDK>
  language: ReturnType<typeof useLanguage>
}) {
  if (input.worktree === "main") return input.projectDirectory

  if (input.worktree !== "create") return input.worktree

  return createWorktree({
    api: input.serverSDK.api,
    data: input.data,
    directory: input.projectDirectory,
    project: input.data.location.info({ directory: input.projectDirectory })?.project,
    branch: input.branch,
  }).catch((error) => {
    showToast({
      title: input.language.t("prompt.toast.worktreeCreateFailed.title"),
      description: errorMessage(input.language, error),
    })
  })
}

function errorMessage(language: ReturnType<typeof useLanguage>, cause: unknown) {
  if (Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message)) return cause.message

  if (
    Predicate.hasProperty(cause, "data") &&
    Predicate.hasProperty(cause.data, "message") &&
    Predicate.isString(cause.data.message) &&
    cause.data.message
  )
    return cause.data.message

  return language.t("common.requestFailed")
}
