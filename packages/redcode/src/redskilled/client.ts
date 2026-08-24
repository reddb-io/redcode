import {
  ClientSideConnection,
  ndJsonStream,
  type Client,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk"

const wireMajor = 1

const controlMethods = {
  drain: "_redskills/project_drain",
  stop: "_redskills/project_stop",
} as const

const workflowCommands = {
  resize: "project_resize",
  stopWorker: "worker_stop",
  recycleWorker: "worker_recycle",
  steerWorker: "runner_steer",
} as const

export type ControlOperation = keyof typeof controlMethods
export type WorkflowOperation = keyof typeof workflowCommands

export interface ProjectControl {
  version: 1
  project_id: string
  project_label: string
  workspace_path: string
  drain_intent: "inactive" | "draining" | "stopped"
  revision: number
  updates: readonly unknown[]
}

export interface ProjectState {
  project_id: string
  project_label: string
  workspace_path: string
  workers: readonly Record<string, unknown>[]
}

export interface Snapshot {
  state: ProjectState
  control: ProjectControl
}

export interface Session {
  snapshot(): Promise<Snapshot>
  control(operation: ControlOperation): Promise<ProjectControl>
  workflow(operation: WorkflowOperation, input: Readonly<Record<string, unknown>>): Promise<void>
  close(): void
}

export interface AdapterProcess {
  readonly writable: WritableStream<Uint8Array>
  readonly readable: ReadableStream<Uint8Array>
  readonly exited: Promise<number>
  stderr(): string
  close(): void
}

export async function createSession(
  cwd: string,
  options: { timeoutMs?: number; spawn?: () => AdapterProcess } = {},
): Promise<Session> {
  const timeout = options.timeoutMs ?? 10_000
  let adapter: AdapterProcess
  try {
    adapter = (options.spawn ?? spawnPublicAdapter)()
  } catch (cause) {
    throw new Error(`Unable to start red-skills-redskilled acp: ${message(cause)}`, { cause })
  }
  const updates: SessionNotification[] = []
  let sessionID = ""
  let activeWorkflow: WorkflowOperation | undefined
  let usable = true
  const connection = new ClientSideConnection(
    () =>
      client(
        (notice) => {
          if (notice.sessionId === sessionID) updates.push(notice)
        },
        (request) => workflowPermission(request, sessionID, activeWorkflow),
      ),
    ndJsonStream(adapter.writable, adapter.readable),
  )

  try {
    const initialized = await exchange(
      adapter,
      connection.initialize({
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: "Redcode", version: "1" },
        _meta: { redskills: { wireMajor } },
      }),
      timeout,
      "initialize",
    )
    const capabilities = advertisedMethods(initialized._meta)
    sessionID = (
      await exchange(adapter, connection.newSession({ cwd, mcpServers: [] }), timeout, "create Project session")
    ).sessionId

    return {
      async snapshot() {
        requireUsable(usable)
        requireCapability(capabilities, "status", "_redskills/project_status")
        try {
          const [state, control] = await Promise.all([
            exchange(adapter, connection.extMethod("_redskills/host_state", {}), timeout, "read Project state"),
            exchange(adapter, connection.extMethod("_redskills/project_status", {}), timeout, "read Project control"),
          ])
          return { state: projectState(state), control: projectControl(control) }
        } catch (cause) {
          throw new Error(`redskilled ACP Project status is unavailable: ${message(cause)}`, { cause })
        }
      },
      async control(operation) {
        requireUsable(usable)
        requireCapability(capabilities, operation, controlMethods[operation])
        return projectControl(
          await exchange(adapter, connection.extMethod(controlMethods[operation], {}), timeout, operation),
        )
      },
      async workflow(operation, input) {
        requireUsable(usable)
        const firstUpdate = updates.length
        activeWorkflow = operation
        try {
          const response = await exchange(
            adapter,
            connection.prompt({
              sessionId: sessionID,
              prompt: [{ type: "text", text: `/${workflowCommands[operation]} ${JSON.stringify(input)}` }],
            }),
            timeout,
            operation,
          )
          requireWorkflowSuccess(operation, response, updates.slice(firstUpdate))
        } catch (cause) {
          usable = false
          activeWorkflow = undefined
          await cancelSession(connection, sessionID, timeout)
          adapter.close()
          throw cause
        } finally {
          activeWorkflow = undefined
        }
      },
      close() {
        usable = false
        adapter.close()
      },
    }
  } catch (cause) {
    const detail = adapter.stderr().trim()
    const reason = message(cause)
    adapter.close()
    throw new Error(
      `Unable to start red-skills-redskilled acp: ${reason}${detail && !reason.includes(detail) ? `\n${detail}` : ""}`,
      { cause },
    )
  }
}

function spawnPublicAdapter(): AdapterProcess {
  const process = Bun.spawn(["red-skills-redskilled", "acp"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  const stderr = capture(process.stderr)
  const close = () => {
    try {
      process.stdin.end()
    } catch {}
    try {
      if (process.exitCode === null) process.kill()
    } catch {}
  }
  return {
    writable: new WritableStream<Uint8Array>({
      write(chunk) {
        process.stdin.write(chunk)
        process.stdin.flush()
      },
      close() {
        process.stdin.end()
      },
      abort() {
        close()
      },
    }),
    readable: process.stdout,
    exited: process.exited,
    stderr,
    close,
  }
}

function capture(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder()
  let output = ""
  void (async () => {
    const reader = stream.getReader()
    try {
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        output = `${output}${decoder.decode(next.value, { stream: true })}`.slice(-16_384)
      }
      output = `${output}${decoder.decode()}`.slice(-16_384)
    } catch {
      // The exit status still identifies an adapter that vanished before stderr settled.
    } finally {
      reader.releaseLock()
    }
  })()
  return () => output
}

async function exchange<T>(
  adapter: AdapterProcess,
  request: Promise<T>,
  timeout: number,
  operation: string,
): Promise<T> {
  return await deadline(
    Promise.race([
      request,
      adapter.exited.then((code) => {
        const detail = adapter.stderr().trim()
        throw new Error(
          `red-skills-redskilled acp exited with code ${code} during ${operation}${detail ? `\n${detail}` : ""}`,
        )
      }),
    ]),
    timeout,
  )
}

function client(
  update: (notice: SessionNotification) => void,
  permission: (request: RequestPermissionRequest) => RequestPermissionResponse,
): Client {
  return {
    async sessionUpdate(notice) {
      update(notice)
    },
    async requestPermission(request) {
      return permission(request)
    },
  }
}

function requireWorkflowSuccess(
  operation: WorkflowOperation,
  response: PromptResponse,
  updates: readonly SessionNotification[],
) {
  const failed = updates.find(
    ({ update }) =>
      (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") &&
      update.status === "failed",
  )?.update
  if (failed && (failed.sessionUpdate === "tool_call" || failed.sessionUpdate === "tool_call_update")) {
    throw new Error(`redskilled ACP ${operation} failed in tool ${failed.title ?? failed.toolCallId}`)
  }
  const outcome = redskills(response._meta)?.workflowOutcome
  if (outcome === "permission-hitl") throw new Error(`redskilled ACP ${operation} requires human permission`)
  if (response.stopReason !== "end_turn") {
    throw new Error(`redskilled ACP ${operation} ended with ${response.stopReason}`)
  }
  const completed = updates.some(
    ({ update }) =>
      (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") &&
      update.status === "completed",
  )
  if (!completed) {
    throw new Error(`redskilled ACP ${operation} returned end_turn without completed tool-call evidence`)
  }
}

function workflowPermission(
  request: RequestPermissionRequest,
  sessionID: string,
  activeWorkflow: WorkflowOperation | undefined,
): RequestPermissionResponse {
  const option =
    activeWorkflow && request.sessionId === sessionID
      ? request.options.find((candidate) => candidate.kind === "allow_once")
      : undefined
  if (!option) {
    return {
      outcome: { outcome: "cancelled" },
      _meta: { redskills: { permissionResolution: "explicit-control-required" } },
    }
  }
  return {
    outcome: { outcome: "selected", optionId: option.optionId },
    _meta: { redskills: { permissionResolution: "explicit-control-allow-once", workflow: activeWorkflow } },
  }
}

async function cancelSession(connection: ClientSideConnection, sessionID: string, timeout: number) {
  await deadline(connection.cancel({ sessionId: sessionID }), Math.min(timeout, 250)).catch(() => undefined)
}

function requireUsable(usable: boolean) {
  if (!usable) throw new Error("redskilled ACP session is unusable after an uncertain workflow outcome")
}

function advertisedMethods(meta: unknown) {
  const found = new Set<string>()
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (typeof item === "string" && item.startsWith("_redskills/")) found.add(item)
        else visit(item)
      })
      return
    }
    if (!isRecord(value)) return
    Object.values(value).forEach(visit)
  }
  visit(isRecord(meta) ? meta.redskills : undefined)
  return found
}

function requireCapability(capabilities: ReadonlySet<string>, operation: string, method: string) {
  if (capabilities.has(method)) return
  throw new Error(`redskilled ACP does not advertise ${operation} capability ${method}`)
}

function redskills(value: unknown) {
  const root = isRecord(value) ? value.redskills : undefined
  return isRecord(root) ? root : undefined
}

function projectState(value: unknown): ProjectState {
  if (
    !isRecord(value) ||
    typeof value.project_id !== "string" ||
    typeof value.project_label !== "string" ||
    typeof value.workspace_path !== "string" ||
    !Array.isArray(value.workers)
  )
    throw new Error("redskilled ACP returned an invalid Project state")
  return {
    project_id: value.project_id,
    project_label: value.project_label,
    workspace_path: value.workspace_path,
    workers: value.workers.filter(isRecord),
  }
}

function projectControl(value: unknown): ProjectControl {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.project_id !== "string" ||
    typeof value.project_label !== "string" ||
    typeof value.workspace_path !== "string" ||
    !["inactive", "draining", "stopped"].includes(String(value.drain_intent)) ||
    typeof value.revision !== "number" ||
    !Array.isArray(value.updates)
  )
    throw new Error("redskilled ACP returned an invalid Project control snapshot")
  return value as unknown as ProjectControl
}

async function deadline<T>(promise: Promise<T>, timeout: number) {
  let timer: Timer | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("redskilled ACP request timed out")), timeout)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function message(value: unknown) {
  return value instanceof Error ? value.message : String(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
