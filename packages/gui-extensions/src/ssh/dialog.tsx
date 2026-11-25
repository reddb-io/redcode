import { Button } from "@opencode/ui/button"
import { uuid } from "@opencode/util/uuid"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Divider } from "@opencode/ui/divider"
import { ReactView } from "@opencode/ui/react-view"
import { input } from "@reddb-io/design-system/base/recipes"
import { SshConnectionFields } from "./connection-fields.react"
import { useDialog } from "@opencode/ui/context/dialog"
import { createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { createKeyed, useExtension } from "../sdk"
import type { SshConfig, SshItem } from "./contract"
import { isSshConnecting, sshName } from "./name"
import type { SshController } from "./state"
import { connectionTarget } from "./target"

export { default as css } from "./ssh.css?inline"

export function DialogSsh(props: {
  ssh: SshController
  config?: SshConfig
  connect?: boolean
  promptOnly?: boolean
  /** Runs with the server id once it connects. Only the palette entry point opens a project. */
  onOpenProject?: (id: string) => void
  onConnected?: () => void
}) {
  const dialog = useDialog()
  const extension = useExtension()
  const ssh = props.ssh
  // Entry-point behavior is fixed for the lifetime of this dialog.
  const openProject = props.onOpenProject
  const id = props.config?.id ?? uuid()
  let cancelButton: HTMLButtonElement | undefined

  const [state, setState] = createStore({
    target: props.config?.target ?? "",
    name: props.config?.name ?? "",
    user: "",
    port: "",
    identity: "",
    started: !!props.promptOnly,
    // Counts `start` calls, each of which forgets the challenges shown before it.
    starts: 0,
    complete: false,
  })

  const item = createMemo(() => ssh.item(id))

  const error = createMemo(() => {
    if (ssh.error(id)) return extension.t("common.requestFailed")
    const error = item()?.error

    return error ? extension.t(`error.${error}`) : undefined
  })

  const busy = createMemo(
    () => ssh.submitting(id) || (state.started && !ssh.error(id) && isSshConnecting(item()?.stage ?? "connecting")),
  )

  const prompt = createMemo<SshItem["prompt"]>((previous) => item()?.prompt ?? (busy() ? previous : undefined))
  // A new object for each challenge shown, and when one goes away.
  const challenge = createMemo(on([prompt, () => prompt()?.id], () => ({})))

  // A challenge showed since the dialog opened, or since the last start when it was started again.
  const prompted = createMemo(
    (previous: { readonly starts: number; readonly value: boolean }) => {
      const shown = !!prompt()

      return previous.starts === state.starts
        ? { starts: state.starts, value: previous.value || shown }
        : { starts: state.starts, value: shown }
    },
    { starts: 0, value: !!props.promptOnly },
  )

  // What the user typed belongs to the challenge it was typed for; the next one starts empty.
  const [typed, setTyped] = createSignal({ challenge: challenge(), value: "" })

  const response = () => {
    const current = typed()

    return current.challenge === challenge() ? current.value : ""
  }

  const waiting = () => busy() || ssh.answered(id)
  const progress = () => {
    switch (item()?.stage) {
      case "checking":
        return extension.t("stage.checking")
      case "downloading":
        return extension.t("stage.downloading")
      case "uploading":
        return extension.t("stage.uploading")
      case "starting":
        return extension.t("stage.starting")
      case "authentication":
        return extension.t("stage.authentication")
      default:
        return extension.t("stage.connecting")
    }
  }

  const start = (replace = false) => {
    if (busy() || !state.target.trim()) return
    setState({ started: true, starts: state.starts + 1 })
    ssh.connect({ id, target: connectionTarget(state), name: state.name }, { dialog: true, replace })
  }

  const respond = () => {
    const current = item()?.prompt

    if (!current || waiting() || (!current.confirm && !response())) return
    ssh.respond(id, current.id, current.confirm ? "yes" : response())
  }

  // Never let a focused Continue button become Trust between SSH challenges.
  createKeyed(
    () => (prompt()?.confirm ? challenge() : undefined),
    () => queueMicrotask(() => cancelButton?.focus()),
  )

  // Closes the dialog once the server it started is ready.
  createKeyed(
    () => state.started && item()?.stage === "ready" && !ssh.submitting(id) && !state.complete,
    () => {
      setState("complete", true)
      dialog.close()

      if (openProject) queueMicrotask(() => openProject(id))

      if (props.onConnected) queueMicrotask(props.onConnected)
    },
  )
  onMount(() => {
    if (props.connect) start()
  })
  onCleanup(() => {
    if (state.started && !state.complete) ssh.cancel(id)
  })

  return (
    <Dialog fit class="settings-server-dialog">
      <DialogHeader hideClose={true}>
        <DialogTitle>
          {prompted().value || props.config ? extension.t("connectTo", { host: sshName(state) }) : extension.t("add")}
        </DialogTitle>
      </DialogHeader>
      <Divider />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col px-4 pt-4 pb-2">
        <div class="flex w-full min-w-0 flex-col gap-6">
          <Show
            when={
              !props.promptOnly && item()?.stage !== "incompatible" && (!prompted().value || (!!error() && !prompt()))
            }
          >
            <ReactView
              component={SshConnectionFields}
              props={{
                values: {
                  target: state.target,
                  name: state.name,
                  user: state.user,
                  port: state.port,
                  identity: state.identity,
                },
                labels: {
                  target: extension.t("target"),
                  name: extension.t("form.name"),
                  user: extension.t("form.user"),
                  port: extension.t("form.port"),
                  identity: extension.t("form.identity"),
                },
                targetPlaceholder: extension.t("placeholder"),
                namePlaceholder: extension.t("form.namePlaceholder"),
                optionsLabel: extension.t("form.connectionOptions"),
                authenticationNote: extension.t("form.authenticationNote"),
                disabled: busy() || !!prompt(),
                invalid: !!error(),
                onChange: (field, value) => setState(field, value),
                onSubmit: () => {
                  if (!prompt()) start(item()?.stage === "incompatible")
                },
              }}
            />
          </Show>
          <Show when={item()?.stage === "incompatible"}>
            <div class="flex w-full min-w-0 flex-col gap-2" role="status" aria-live="polite">
              <span class="text-14-medium text-foreground">{extension.t("stage.incompatible")}</span>
              <span class="text-13-regular text-ink-muted">{extension.t("error.version")}</span>
            </div>
          </Show>
          <Show when={prompt()} keyed>
            {(prompt) => (
              <div class="flex w-full min-w-0 flex-col gap-2">
                <pre id="ssh-prompt" class="ssh-prompt" dir="auto">
                  {prompt.text}
                </pre>
                <Show when={!prompt.confirm}>
                  <input
                    id="ssh-response"
                    aria-labelledby="ssh-prompt"
                    ref={(element) =>
                      queueMicrotask(() => {
                        if (element.isConnected) element.focus()
                      })
                    }
                    type="password"
                    class={input({ size: "md" })}
                    autofocus
                    value={response()}
                    autocomplete="off"
                    spellcheck={false}
                    disabled={waiting()}
                    onInput={(event) => setTyped({ challenge: challenge(), value: event.currentTarget.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.isComposing) {
                        event.preventDefault()
                        respond()
                      }
                    }}
                  />
                </Show>
              </div>
            )}
          </Show>
          <Show when={item()?.stage !== "incompatible" && error()}>
            {(error) => (
              <span class="settings-server-dialog-error !leading-[var(--line-height-compact)]" role="alert">
                {error()}
              </span>
            )}
          </Show>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button
          ref={(element: HTMLButtonElement) => {
            cancelButton = element
          }}
          variant="neutral"
          onClick={() => dialog.close()}
        >
          {extension.t("common.cancel")}
        </Button>
        <Show
          when={prompt()}
          fallback={
            <Button
              variant="contrast"
              disabled={busy() || !state.target.trim()}
              onClick={() => start(item()?.stage === "incompatible")}
            >
              {busy()
                ? progress()
                : item()?.stage === "incompatible"
                  ? extension.t("update")
                  : props.config
                    ? extension.t("connect")
                    : extension.t("form.add")}
            </Button>
          }
        >
          {(prompt) => (
            <Button variant="contrast" disabled={waiting() || (!prompt().confirm && !response())} onClick={respond}>
              {waiting() ? extension.t("stage.connecting") : extension.t(prompt().confirm ? "trust" : "continue")}
            </Button>
          )}
        </Show>
      </DialogFooter>
    </Dialog>
  )
}
