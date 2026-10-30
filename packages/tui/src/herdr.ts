import type { SessionInfo } from "@opencode/client"
import type { Data, Route } from "@opencode/plugin/tui/context"
import { spawn } from "node:child_process"
import { createEffect, createRoot } from "solid-js"

export function startHerdr(input: {
  data: Data
  route: () => Route
  connected: () => boolean
  resume: (session: SessionInfo) => readonly string[]
  environment?: NodeJS.ProcessEnv
  report?: (args: readonly string[]) => Promise<boolean>
}) {
  const environment = input.environment ?? process.env
  const binary = environment.HERDR_BIN_PATH
  const pane = environment.HERDR_PANE_ID
  if (environment.HERDR_ENV !== "1" || !binary || !pane || !environment.HERDR_SOCKET_PATH) return

  const state = {
    sessionID: undefined as string | undefined,
    pending: undefined as string[] | undefined,
    sent: "",
    restorable: false,
    running: undefined as Promise<void> | undefined,
    retry: undefined as ReturnType<typeof setTimeout> | undefined,
    sequence: Date.now() * 1000,
    closed: false,
    closing: undefined as Promise<void> | undefined,
  }
  const send = (args: string[]) => {
    // Herdr options belong before the resume command's `--` separator.
    const separator = args.indexOf("--")
    const command = separator < 0 ? args : args.slice(0, separator)
    const resume = separator < 0 ? [] : args.slice(separator)
    const argv = [
      "pane",
      ...command,
      "--source",
      "redcode.tui",
      "--agent",
      "redcode",
      "--seq",
      String(++state.sequence),
      ...resume,
    ]
    return Promise.resolve()
      .then(() =>
        input.report
          ? input.report(argv)
          : new Promise<boolean>((resolve) => {
              const child = spawn(binary, argv, {
                env: environment,
                stdio: "ignore",
                timeout: 1_000,
                killSignal: "SIGKILL",
                windowsHide: true,
              })
              child.once("error", () => resolve(false))
              child.once("close", (code) => resolve(code === 0))
            }),
      )
      .catch(() => false)
  }

  const flush = () => {
    if (state.running) return state.running
    state.running = (async () => {
      while (state.pending) {
        const args = state.pending
        state.pending = undefined
        const key = JSON.stringify(args)
        if (key === state.sent) continue
        // An omitted resume command leaves Herdr's previous one in place.
        // Clear it when the selected session was deleted or cannot be restored.
        const cleared = !state.restorable || args.includes("--") || (await send(["release-agent", pane]))
        if (cleared && !args.includes("--")) state.restorable = false
        const delivered = cleared && (await send(args))
        if (delivered) {
          state.sent = key
          state.restorable = args.includes("--")
        }
        if (!delivered && !state.closed) {
          state.pending ??= args
          state.retry = setTimeout(() => {
            state.retry = undefined
            void flush()
          }, 1_000)
          break
        }
      }
    })().finally(() => {
      state.running = undefined
      if (state.pending && !state.retry) void flush()
    })
    return state.running
  }

  const dispose = createRoot((dispose) => {
    createEffect(() => {
      const route = input.route()
      if (route.type === "session") {
        state.sessionID = input.data.session.root(route.sessionID)
        // A direct attachment to a child can arrive before its root is cached.
        if (input.connected() && !input.data.session.get(state.sessionID) && input.data.session.get(route.sessionID))
          void input.data.session.sync(state.sessionID).catch(() => undefined)
      }
      const session = state.sessionID ? input.data.session.get(state.sessionID) : undefined
      const family = session ? [session.id, ...input.data.session.family(session.id)] : []
      const blocked =
        family.some(
          (id) => input.data.session.permission.list(id)?.length || input.data.session.form.list(id)?.length,
        ) ||
        (session && input.data.session.form.list("global", session.location)?.length)
      const status =
        !input.connected() || (state.sessionID && !session)
          ? "unknown"
          : blocked
            ? "blocked"
            : family.some((id) => input.data.session.status(id) === "running")
              ? "working"
              : "idle"
      const resume = session ? input.resume(session) : []
      // Resume argv has stricter limits than normal CLI argv. State reporting
      // still works when a launch option cannot be safely restored.
      const resumable =
        resume.length > 0 &&
        resume.length <= 64 &&
        /^[A-Za-z0-9_.-]+$/.test(resume[0]) &&
        resume.every((arg) => !/['\x00-\x1f\x7f]/.test(arg)) &&
        Buffer.byteLength(resume.join("\0")) <= 8 * 1024
      state.pending = [
        "report-agent",
        pane,
        "--state",
        status,
        ...(session && resumable ? ["--agent-session-id", session.id, "--", ...resume] : []),
      ]
      if (!state.retry) void flush()
    })
    return dispose
  })

  return () =>
    (state.closing ??= (async () => {
      state.closed = true
      dispose()
      if (state.retry) clearTimeout(state.retry)
      state.pending = undefined
      await state.running
      await send(["release-agent", pane])
    })())
}
