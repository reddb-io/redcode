import { Plugin } from "@opencode/plugin/tui"
import { ProjectEnvironment } from "@opencode/schema/project-environment"
import { AbsolutePath } from "@opencode/schema/schema"
import { Schema } from "effect"
import { randomUUID } from "node:crypto"
import { createStore } from "solid-js/store"
import { DialogSelect } from "../../ui/dialog-select"
import { errorMessage } from "../../util/error"

export default Plugin.define({
  id: "redcode.environments",
  setup(context) {
    const controller = new AbortController()
    const [state, setState] = createStore<{ directory: string; snapshot?: ProjectEnvironment.Snapshot; busy: boolean }>(
      {
        directory: context.location?.directory ?? context.data.location.default()?.directory ?? "",
        busy: false,
      },
    )
    const load = async () => {
      const snapshot = Schema.decodeUnknownSync(ProjectEnvironment.Snapshot)(
        await context.client.projectEnvironments.list(
          { directory: AbsolutePath.make(state.directory) },
          { signal: controller.signal },
        ),
      )
      if (!controller.signal.aborted) setState("snapshot", snapshot)
    }
    const perform = async (operation?: () => Promise<unknown>) => {
      if (state.busy) return
      setState("busy", true)
      try {
        if (operation) await operation()
        if (!controller.signal.aborted) await load()
      } catch (error) {
        if (!controller.signal.aborted) context.ui.toast.show({ variant: "error", message: errorMessage(error) })
      } finally {
        if (!controller.signal.aborted) setState("busy", false)
      }
    }
    const configure = async (recipe?: ProjectEnvironment.Recipe) => {
      const id = await context.ui.dialog.prompt({ title: "Recipe ID", value: recipe?.id ?? "dev" })
      if (!id) return
      const name = await context.ui.dialog.prompt({ title: "Recipe name", value: recipe?.name ?? id })
      if (!name) return
      const backend = await context.ui.dialog.select({
        title: "Execution backend on the connected host",
        options: [
          {
            value: "compose" as const,
            title: "Docker Compose",
            description: "Managed project name per worktree; volumes retained",
          },
          {
            value: "commands" as const,
            title: "Project commands",
            description: "Explicit start and stop commands that return",
          },
        ],
      })
      if (!backend) return
      const composeFile =
        backend === "compose"
          ? await context.ui.dialog.prompt({
              title: "Compose file relative to this worktree",
              value: recipe?.composeFile ?? "compose.yaml",
            })
          : "compose.yaml"
      if (composeFile === undefined) return
      const prepare = await context.ui.dialog.prompt({
        title: "Preparation command (optional)",
        value: recipe?.prepare ?? "",
      })
      if (prepare === undefined) return
      const start =
        backend === "commands"
          ? await context.ui.dialog.prompt({ title: "Start command", value: recipe?.start ?? "" })
          : ""
      if (start === undefined) return
      const stop =
        backend === "commands"
          ? await context.ui.dialog.prompt({ title: "Stop command", value: recipe?.stop ?? "" })
          : ""
      if (stop === undefined) return
      const validate = await context.ui.dialog.prompt({
        title: "Validation command",
        value: recipe?.validate ?? "",
        description:
          "Exit successfully only when this environment works. Commands use PowerShell on Windows and sh on Linux/macOS.",
      })
      if (!validate) return
      const bindings = await context.ui.dialog.prompt({
        title: "Vault bindings (optional)",
        value: Object.entries(recipe?.secrets ?? {})
          .map(([key, name]) => `${key}=${name}`)
          .join(","),
        description: "Comma-separated VARIABLE=vault-name. Do not enter secret values.",
      })
      if (bindings === undefined) return
      await perform(async () => {
        const secrets = Object.fromEntries(
          bindings
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
            .map((value) => {
              const index = value.indexOf("=")
              if (index < 1) throw new Error("Use VARIABLE=vault-name")
              return [value.slice(0, index), value.slice(index + 1)]
            }),
        )
        await context.client.projectEnvironments.save({
          directory: AbsolutePath.make(state.directory),
          expectedRevision: recipe && recipe.id === id ? recipe.revision : 0,
          definition: {
            id,
            name,
            backend,
            composeFile,
            prepare,
            start,
            stop,
            validate,
            timeoutSeconds: recipe?.timeoutSeconds ?? 300,
            secrets,
          },
        })
      })
      show()
    }
    const operate = async (recipe: ProjectEnvironment.Recipe) => {
      const current = state.snapshot?.environments.find(
        (item) => item.recipeID === recipe.id && item.directory === state.snapshot?.directory,
      )
      const action = await context.ui.dialog.select({
        title: `${recipe.name} · revision ${recipe.revision}`,
        options: (current?.state === "reconcile"
          ? (["reconcile"] as const)
          : (["prepare", "start", "stop", "recreate", "validate"] as const)
        ).map((value) => ({ value, title: value })),
      })
      if (!action) {
        show()
        return
      }
      const confirmed = await context.ui.dialog.confirm({
        title: `Run ${action} on the connected host?`,
        message:
          action === "reconcile"
            ? "Confirm the original commands have stopped. No commands will be replayed. Existing data is retained."
            : [
                state.directory,
                `${recipe.backend}: ${recipe.composeFile}`,
                recipe.prepare,
                recipe.start,
                recipe.stop,
                recipe.validate,
              ]
                .filter(Boolean)
                .join("\n\n"),
      })
      if (confirmed)
        await perform(() =>
          context.client.projectEnvironments.run({
            directory: AbsolutePath.make(state.directory),
            recipeID: recipe.id,
            revision: recipe.revision,
            action,
            requestID: randomUUID(),
            ...(action === "reconcile" ? { confirmReconciled: true } : {}),
          }),
        )
      show()
    }
    const changeDirectory = async () => {
      const answer = await context.ui.dialog.prompt({
        title: "Project/worktree directory on the connected host",
        value: state.directory,
      })
      if (!answer) return
      setState("directory", answer)
      await perform()
      show()
    }
    const show = () =>
      context.ui.dialog.show(() => (
        <DialogSelect
          title="Project environments"
          locked={state.busy}
          preserveSelection
          options={(state.snapshot?.recipes ?? []).map((recipe) => {
            const current = state.snapshot?.environments.find(
              (item) => item.recipeID === recipe.id && item.directory === state.snapshot?.directory,
            )
            return {
              value: recipe.id,
              title: recipe.name,
              footer: current?.state ?? "not started",
              details: [
                state.directory,
                `Revision ${recipe.revision} · ${recipe.backend}`,
                ...(current?.detail ? [current.detail] : []),
                ...(current?.output ? [current.output.slice(-4096)] : []),
              ],
              detailsWrap: true,
            }
          })}
          onSelect={(option) => {
            const recipe = state.snapshot?.recipes.find((item) => item.id === option.value)
            if (recipe) void operate(recipe)
          }}
          actions={[
            {
              command: "environments.new",
              title: "new recipe",
              selection: "none",
              bind: "ctrl+n",
              onTrigger: () => void configure(),
            },
            {
              command: "environments.edit",
              title: "edit",
              bind: "ctrl+e",
              onTrigger: (option) => void configure(state.snapshot?.recipes.find((item) => item.id === option.value)),
            },
            {
              command: "environments.directory",
              title: "directory",
              selection: "none",
              onTrigger: () => void changeDirectory(),
            },
            {
              command: "environments.refresh",
              title: "refresh",
              selection: "none",
              bind: "ctrl+r",
              onTrigger: () => void perform(),
            },
          ]}
          footerHints={[{ title: "enter", label: "choose operation" }]}
        />
      ))
    context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "environments.open",
              title: "Project environments",
              group: "System",
              slash: { name: "environments" },
              palette: true,
              run: () => {
                setState("directory", context.location?.directory ?? context.data.location.default()?.directory ?? "")
                void (state.directory ? perform().then(show) : changeDirectory())
              },
            },
          ],
        }))
        return null
      },
    })
    return () => controller.abort()
  },
})
