export * as Harnesses from "./harness"

import { mkdir, realpath } from "node:fs/promises"
import path from "node:path"
import { hostname } from "node:os"
import spawn from "cross-spawn"
import { Harness } from "@opencode/schema/harness"
import { UsageReporter } from "@opencode/schema/usage-reporter"
import { createHash } from "node:crypto"
import { AbsolutePath } from "@opencode/schema/schema"
import { Global } from "@opencode/util/global"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { object, string, wire, stopOwnedProcess, type Frame, type Wire } from "./harness-wire"
import { createHarnessTasks } from "./harness-tasks"
import { createHarnessDelegation } from "./harness-delegation"
import { createHarnessTools } from "./harness-tools"
import { App } from "@opencode/core/app"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionStore } from "@opencode/core/session/store"
import { SubagentCompletion } from "@opencode/core/session/subagent-completion"
import { ExternalDelegation } from "@opencode/core/external-delegation"
import { Location } from "@opencode/schema/location"
import { harnessCapabilities } from "./agent-runtime/adapter"
import { CodexRuntimeProtocol } from "./agent-runtime/adapters/codex"
import { agentRuntime } from "./agent-runtime/registry"
import { createAgentRuntimeSupervisor } from "./agent-runtime/supervisor"

type Pending = { request: Harness.Request; frame: Frame }
type Live = {
  release: () => Promise<void>
  wire: Wire
  turn: string
  pending: Map<string, Pending>
  sending: boolean
  input?: string
  started?: number
  tools?: ReturnType<typeof createHarnessTools>
}

// Tokens distinguish independent server scopes hosted by the same OS process.
const harnessOwners = new Set<string>()
type HarnessOwner = { host: string; owner_pid: number; owner_token: string; child_pid: number | null; eligible: number }
type ProviderInstance = {
  id: string
  driver: Harness.Driver
  label: string
  executable: string
  home: string | null
  credential_revision: number
  configured: number
  idle_timeout_ms: number
}
const processAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH"
  }
}
const ownerAlive = (owner: HarnessOwner, host: string) =>
  owner.host !== host ||
  (owner.owner_pid === process.pid ? harnessOwners.has(owner.owner_token) : processAlive(owner.owner_pid))

/** Persistence belongs to the execution host; resumed parents never replay ambiguous input. */
export async function createHarnesses(
  directory: string,
  app = App.make({ name: "redcode" }),
  native?: {
    deliver: (sessionID: string, requestID: string, result: string) => Promise<void>
    start?: (parent: string, child: string, directory: string, task: string) => Promise<void>
    run?: (
      child: string,
      signal: AbortSignal,
    ) => Promise<{ status: "completed" | "failed" | "interrupted"; text: string }>
    recover?: (
      child: string,
      signal: AbortSignal,
    ) => Promise<{ status: "completed" | "failed" | "interrupted"; text: string } | undefined>
    interrupt?: (child: string) => Promise<boolean>
  },
) {
  const { Database } = await import("bun:sqlite")
  await mkdir(directory, { recursive: true })
  const db = new Database(path.join(directory, "harness.sqlite"), { create: true })
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS config (driver TEXT PRIMARY KEY, executable TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS provider_instance (
      id TEXT PRIMARY KEY, driver TEXT NOT NULL, label TEXT NOT NULL, executable TEXT NOT NULL,
      home TEXT, credential_revision INTEGER NOT NULL DEFAULT 1, configured INTEGER NOT NULL DEFAULT 0,
      idle_timeout_ms INTEGER NOT NULL DEFAULT 60000
    );
    CREATE TABLE IF NOT EXISTS run (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS event (cursor INTEGER PRIMARY KEY AUTOINCREMENT, run TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS event_run ON event(run,cursor);
    CREATE TABLE IF NOT EXISTS prompt (id TEXT PRIMARY KEY, run TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL);`)
  const providerColumns = db.query<{ name: string }, []>("PRAGMA table_info(provider_instance)").all()
  if (!providerColumns.some((column) => column.name === "configured"))
    db.exec("ALTER TABLE provider_instance ADD COLUMN configured INTEGER NOT NULL DEFAULT 0")
  if (!providerColumns.some((column) => column.name === "idle_timeout_ms"))
    db.exec("ALTER TABLE provider_instance ADD COLUMN idle_timeout_ms INTEGER NOT NULL DEFAULT 60000")
  db.exec(`INSERT OR IGNORE INTO provider_instance(id,driver,label,executable,credential_revision,configured)
    SELECT driver || '-default',driver,'Default',executable,1,1 FROM config;
    UPDATE provider_instance SET configured=1
      WHERE id IN (SELECT driver || '-default' FROM config);
    INSERT OR IGNORE INTO provider_instance(id,driver,label,executable,credential_revision)
    VALUES ('codex-default','codex','Default','codex',1), ('claude-default','claude','Default','claude',1);`)
  db.exec(`CREATE TABLE IF NOT EXISTS harness_process (
    run TEXT PRIMARY KEY, host TEXT NOT NULL, owner_pid INTEGER NOT NULL, owner_token TEXT NOT NULL,
    child_pid INTEGER, eligible INTEGER NOT NULL DEFAULT 0
  )`)
  const ownerToken = crypto.randomUUID()
  const localHost = hostname()
  harnessOwners.add(ownerToken)
  const processOwner = (id: string) =>
    db
      .query<
        HarnessOwner,
        [string]
      >("SELECT host,owner_pid,owner_token,child_pid,eligible FROM harness_process WHERE run=?")
      .get(id)
  db.exec(
    "CREATE TABLE IF NOT EXISTS metric (id TEXT PRIMARY KEY, data TEXT NOT NULL, reported INTEGER NOT NULL DEFAULT 0)",
  )
  const tasks = createHarnessTasks(db)
  const live = new Map<string, Live>()
  const supervisor = createAgentRuntimeSupervisor()
  const lifetime = { closed: false }
  const recovering = new Set<Promise<void>>()
  let recoveryTimer: ReturnType<typeof setInterval> | undefined
  const providers = new Map<string, Harness.Provider>()
  const logins = new Map<string, Harness.Login>()
  const loginWires = new Map<
    string,
    { id: string; close: () => Promise<void>; answer?: (code: string) => void }
  >()
  const write = (run: Harness.Run) =>
    db.query("INSERT OR REPLACE INTO run VALUES (?,?)").run(run.id, JSON.stringify(run))
  const read = (id: string) => {
    const row = db.query<{ data: string }, [string]>("SELECT data FROM run WHERE id=?").get(id)
    if (!row) throw new Error("Harness run not found")
    return Schema.decodeUnknownSync(Schema.fromJsonString(Harness.Run))(row.data)
  }
  const runs = () =>
    db
      .query<{ data: string }, []>("SELECT data FROM run ORDER BY rowid DESC")
      .all()
      .map((row) => Schema.decodeUnknownSync(Schema.fromJsonString(Harness.Run))(row.data))
  const queued = (id: string) =>
    db
      .query<{ count: number }, [string]>("SELECT count(*) AS count FROM prompt WHERE run=? AND status='queued'")
      .get(id)?.count ?? 0
  const update = (id: string, input: Partial<Harness.Run>) => {
    const next = { ...read(id), ...input }
    write(next)
    return next
  }
  const event = (id: string, kind: "text" | "activity" | "error", text: string) => {
    if (text) db.query("INSERT INTO event(run,kind,text) VALUES (?,?,?)").run(id, kind, text.slice(0, 64_000))
  }
  const metric = (
    id: string,
    identity: string,
    tokens: UsageReporter.Record["tokens"],
    cost: number | null,
    scope: "interaction" | "session",
    status: UsageReporter.Record["status"],
    model?: string | null,
    pricing: "reported" | "estimated" = "reported",
  ) => {
    const run = read(id)
    const connection = live.get(id)
    const key = `harness:${createHash("sha256").update(`${id}:${run.nativeID}:${identity}`).digest("hex")}`
    const counts =
      db
        .query<
          { total: number },
          [string]
        >("SELECT count(*) AS total FROM prompt WHERE run=? AND status IN ('sent','admitted')")
        .get(id)?.total ?? 0
    const at = Date.now()
    const value: UsageReporter.Record = {
      id: key,
      version: 1,
      instanceID: "execution-host",
      type: scope === "session" ? "session.summary.updated" : "model.usage.recorded",
      sessionID: id,
      nativeSessionID: run.nativeID ?? null,
      parentSessionID: null,
      projectID: null,
      workspaceID: null,
      source: run.driver,
      stage: "external",
      scope,
      coverage: run.driver === "claude" ? (scope === "session" ? "session_tree" : "main_loop") : "native_session",
      operation: scope === "session" ? "summary" : "generation",
      provider: null,
      model: model === undefined ? run.model || null : model || null,
      messageID: connection?.input ?? null,
      messageSequence: counts,
      revision: scope === "session" ? at : null,
      usageRecords: scope === "session" ? 0 : 1,
      unknownUsageRecords: tokens ? 0 : 1,
      unpricedRecords: cost === null ? 1 : 0,
      retryCount: null,
      messages: { total: null, user: counts, assistant: null },
      status,
      tokens,
      usageBasis: tokens ? "reported" : "unknown",
      cost,
      currency: "USD",
      pricingBasis: cost === null ? "unknown" : pricing,
      startedAt: connection?.started ?? at,
      completedAt: at,
      durationMs: connection?.started === undefined ? null : Math.max(0, at - connection.started),
      firstOutputMs: null,
      streamDurationMs: null,
      tools: null,
    }
    const decoded = Schema.decodeUnknownOption(UsageReporter.Record)(value)
    if (Option.isSome(decoded))
      db.query("INSERT OR IGNORE INTO metric(id,data) VALUES (?,?)").run(key, JSON.stringify(decoded.value))
  }
  const defaultInstanceID = (driver: Harness.Driver) => `${driver}-default`
  const providerInstances = () =>
    db
      .query<ProviderInstance, []>(
        "SELECT id,driver,label,executable,home,credential_revision,configured,idle_timeout_ms FROM provider_instance ORDER BY driver,id",
      )
      .all()
  const providerInstance = (driver: Harness.Driver, id?: string) => {
    const instance = db
      .query<ProviderInstance, [string]>(
        "SELECT id,driver,label,executable,home,credential_revision,configured,idle_timeout_ms FROM provider_instance WHERE id=?",
      )
      .get(id ?? defaultInstanceID(driver))
    if (!instance) throw new Error("Provider instance is not configured")
    if (instance.driver !== driver) throw new Error("Provider instance belongs to another driver")
    return instance
  }
  const providerInstanceForKey = (key: string) => {
    if (key === "codex" || key === "claude") return providerInstance(key)
    const instance = db
      .query<ProviderInstance, [string]>(
        "SELECT id,driver,label,executable,home,credential_revision,configured,idle_timeout_ms FROM provider_instance WHERE id=?",
      )
      .get(key)
    if (!instance) throw new Error("Provider instance is not configured")
    return instance
  }
  const runtimeEnvironment = (instance: ProviderInstance) => {
    if (!instance.home) return undefined
    return { [instance.driver === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR"]: instance.home }
  }
  const advanceCredentialRevision = (id: string) => {
    const instance = providerInstanceForKey(id)
    void supervisor.evict(JSON.stringify([instance.id, instance.credential_revision]))
    db.query("UPDATE provider_instance SET credential_revision=credential_revision+1 WHERE id=?").run(id)
    providers.delete(id)
  }
  runs()
    .filter((run) => {
      const owner = processOwner(run.id)
      return !owner || !ownerAlive(owner, localHost)
    })
    .forEach((run) => tasks.unavailable(run.id))
  runs()
    .filter((run) => {
      const owner = processOwner(run.id)
      return !["closed", "failed", "interrupted"].includes(run.state) && (!owner || !ownerAlive(owner, localHost))
    })
    .forEach((run) =>
      write({
        ...run,
        state: "unknown",
        detail: "Host restarted. Resume explicitly; unfinished input is not replayed.",
      }),
    )

  const call = (
    command: string,
    args: string[],
    timeout = 15_000,
    codes = [0],
    environment?: Record<string, string>,
  ) =>
    new Promise<string>((resolve, reject) => {
      const child = spawn(command, args, {
        env: environment ? { ...process.env, ...environment } : process.env,
        windowsHide: true,
      })
      const output = { value: "", error: "" }
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error("Harness operation timed out"))
      }, timeout)
      child.stdout?.on("data", (chunk: Buffer) => {
        output.value = (output.value + chunk.toString()).slice(-16_000)
      })
      child.stderr?.on("data", (chunk: Buffer) => {
        output.error = (output.error + chunk.toString()).slice(-1000)
      })
      child.on("error", (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.on("exit", (code) => {
        clearTimeout(timer)
        code !== null && codes.includes(code)
          ? resolve(output.value.trim())
          : reject(new Error(output.error || "Harness diagnostic failed"))
      })
    })
  const provider = (instance: ProviderInstance): Harness.Provider =>
    providers.get(instance.id) ?? {
      id: instance.id,
      driver: instance.driver,
      label: instance.label,
      executable: instance.executable,
      ...(instance.home ? { home: AbsolutePath.make(instance.home) } : {}),
      credentialRevision: instance.credential_revision,
      configured: instance.configured === 1,
      idleTimeoutMs: instance.idle_timeout_ms,
      installed: false,
    }
  const probe = async (driver: Harness.Driver, providerInstanceID?: string) => {
    const instance = providerInstance(driver, providerInstanceID)
    const environment = runtimeEnvironment(instance)
    const version = await call(instance.executable, ["--version"], 15_000, [0], environment).catch(() => undefined)
    if (!version) {
      const result = { ...provider(instance), installed: false }
      providers.set(instance.id, result)
      return result
    }
    const result = {
      id: instance.id,
      driver,
      label: instance.label,
      executable: instance.executable,
      ...(instance.home ? { home: AbsolutePath.make(instance.home) } : {}),
      credentialRevision: instance.credential_revision,
      configured: instance.configured === 1,
      idleTimeoutMs: instance.idle_timeout_ms,
      installed: true,
      version,
      authenticated: undefined as boolean | undefined,
      models: undefined as Harness.Provider["models"],
      detail: undefined as string | undefined,
    }
    if (driver === "claude") {
      const auth = await call(instance.executable, ["auth", "status", "--json"], 15_000, [0, 1], environment).catch(
        () => undefined,
      )
      if (auth) {
        const parsed = object(JSON.parse(auth))
        result.authenticated = parsed.loggedIn === true
      }
    }
    if (driver === "codex") {
      const connection = wire({
        executable: instance.executable,
        args: ["app-server"],
        directory: process.cwd(),
        environment,
        frame: () => {},
        exit: () => {},
      })
      try {
        await CodexRuntimeProtocol.initialize(connection, app.version, false)
        const status = await connection.request("account/read", { refreshToken: false }, driver)
        result.authenticated = status.account !== null && status.account !== undefined
        result.models = await CodexRuntimeProtocol.models(connection).catch((error: unknown) => {
          result.detail = `Could not load Codex models: ${error instanceof Error ? error.message : String(error)}`
          return undefined
        })
      } finally {
        await connection.close()
      }
    }
    providers.set(instance.id, result)
    return result
  }
  const requests = (id: string) => [...(live.get(id)?.pending.values() ?? [])].map((item) => item.request)
  const frame = (id: string, value: Frame) => {
    if (lifetime.closed) return
    const run = read(id)
    const connection = live.get(id)
    if (!connection) return
    // Native background items may finish after their launching turn; correlate their identities before turn filtering.
    tasks.observe(run, value)
    // Closing may still flush native frames; they cannot reopen an execution already closed by the operator.
    if (run.state === "closed") return
    const adapter = agentRuntime(run.driver)
    const input = { frame: value, inputID: connection.input, run, turn: connection.turn }
    if (!adapter.accepts(input)) return
    if (connection.tools?.handle(value)) return
    adapter
      .events(input)
      .forEach((runtimeEvent) => {
        if (runtimeEvent.type === "text" || runtimeEvent.type === "activity") {
          event(id, runtimeEvent.type, runtimeEvent.text)
          return
        }
        if (runtimeEvent.type === "usage") {
          const value = runtimeEvent.metric
          metric(id, value.identity, value.tokens, value.cost, value.scope, value.status, value.model, value.pricing)
          return
        }
        if (runtimeEvent.type === "request") {
          connection.pending.set(runtimeEvent.key, {
            frame: runtimeEvent.frame,
            request: {
              id: runtimeEvent.key,
              kind: runtimeEvent.questions.length
                ? "question"
                : runtimeEvent.supported
                  ? "permission"
                  : "unsupported",
              title: runtimeEvent.title,
              detail: runtimeEvent.detail,
              questions: runtimeEvent.questions,
            },
          })
          update(id, { state: "waiting" })
          return
        }
        if (runtimeEvent.type === "request.resolved") {
          connection.tools?.cancel(runtimeEvent.id)
          connection.pending.delete(runtimeEvent.id)
          return
        }
        if (runtimeEvent.type === "session") {
          if (runtimeEvent.nativeID !== run.nativeID) update(id, { nativeID: runtimeEvent.nativeID })
          return
        }
        if (runtimeEvent.type === "started") {
          connection.turn = runtimeEvent.turn
          update(id, { state: "running" })
          return
        }
        delegation.settle(id, runtimeEvent.outcome, runtimeEvent.detail)
        connection.tools?.cancel()
        runtimeEvent.metrics.forEach((value) =>
          metric(id, value.identity, value.tokens, value.cost, value.scope, value.status, value.model, value.pricing),
        )
        connection.turn = ""
        connection.pending.clear()
        update(id, {
          ...(runtimeEvent.nativeID ? { nativeID: runtimeEvent.nativeID } : {}),
          state:
            runtimeEvent.outcome === "failed"
              ? "failed"
              : runtimeEvent.outcome === "interrupted"
                ? "interrupted"
                : "ready",
          detail: runtimeEvent.detail,
        })
        void drain(id)
        if (runtimeEvent.outcome === "completed") void delegation.flush(id).catch(() => {})
      })
  }
  const launch = async (run: Harness.Run) => {
    if (live.has(run.id)) throw new Error("Harness is already attached")
    const canonical = await realpath(run.directory)
    if (lifetime.closed) throw new Error("Host is shutting down")
    if (canonical !== run.directory) throw new Error("Checkout moved; select its current canonical path")
    // The NULL child PID is a write-ahead marker: a crash during spawn is ambiguous.
    db.query(
      "INSERT OR REPLACE INTO harness_process(run,host,owner_pid,owner_token,child_pid,eligible) VALUES (?,?,?,?,NULL,?)",
    ).run(run.id, localHost, process.pid, ownerToken, run.delegation ? 1 : 0)
    update(run.id, { state: "starting", detail: undefined })
    const adapter = agentRuntime(run.driver)
    const instance = providerInstance(run.driver, run.providerInstanceID)
    const environment = runtimeEnvironment(instance)
    const reusable = adapter.capabilities.multipleThreadsPerRuntime
    const handle = supervisor.acquire({
      key: reusable ? JSON.stringify([instance.id, instance.credential_revision]) : `run:${run.id}`,
      label: `${run.driver} · ${instance.label}`,
      owner: run.id,
      reusable,
      idleTimeoutMs: reusable ? instance.idle_timeout_ms : 0,
      executable: instance.executable,
      args: adapter.launchArgs(run),
      directory: reusable ? process.cwd() : canonical,
      environment,
      subscriber: {
        frame: (value) => frame(run.id, value),
        exit: (detail) => {
          if (live.get(run.id)?.wire !== handle.wire) return
          live.delete(run.id)
          if (lifetime.closed) return
          tasks.unavailable(run.id)
          if (read(run.id).state !== "closed") update(run.id, { state: "unknown", detail })
        },
      },
    })
    const connection = handle.wire
    if (connection.pid)
      db.query("UPDATE harness_process SET child_pid=? WHERE run=? AND owner_token=?").run(
        connection.pid,
        run.id,
        ownerToken,
      )
    live.set(run.id, {
      release: handle.release,
      wire: connection,
      turn: "",
      pending: new Map(),
      sending: false,
      ...(run.backgroundWait || run.delegation
        ? {
            tools: createHarnessTools({
              driver: run.driver,
              waitEnabled: !!run.backgroundWait,
              wait: (taskID, timeoutMs, signal) => tasks.wait(run.id, taskID, timeoutMs, signal),
              ...(run.delegation
                ? {
                    delegation: {
                      delegate: (args: unknown) => delegation.delegate(run.id, args),
                      status: (taskID: string) => delegation.status(run.id, taskID),
                      cancel: (taskID: string) => delegation.cancel(run.id, taskID),
                    },
                  }
                : {}),
              send: (frame) => {
                if (
                  !lifetime.closed &&
                  live.get(run.id)?.wire === connection &&
                  read(run.id).state !== "closed" &&
                  connection.available()
                )
                  connection.send(frame)
              },
            }),
          }
        : {}),
    })
    try {
      await handle.initialize(() =>
        adapter.initialize({ appVersion: app.version, directory: canonical, run, wire: connection }),
      )
      const opened = await adapter.open({ appVersion: app.version, directory: canonical, run, wire: connection })
      if (opened.nativeID) update(run.id, { nativeID: opened.nativeID })
      return update(run.id, { state: "ready" })
    } catch (error) {
      update(run.id, { state: "failed", detail: error instanceof Error ? error.message : String(error) })
      await handle.release()
      throw error
    }
  }
  const deliver = async (id: string, prompt: { id: string; text: string }, steer = false) => {
    const run = read(id)
    const connection = live.get(id)
    if (!connection) throw new Error("Resume the harness before sending input")
    update(id, { state: "running" })
    if (!steer) {
      connection.input = prompt.id
      connection.started = Date.now()
    }
    db.query("UPDATE prompt SET status='admitted' WHERE id=?").run(prompt.id)
    const result = await agentRuntime(run.driver).prompt({
      prompt,
      run,
      steer,
      turn: connection.turn,
      wire: connection.wire,
    })
    if (result.turn) connection.turn = result.turn
    db.query("UPDATE prompt SET status='sent' WHERE id=?").run(prompt.id)
  }
  const drain = async (id: string) => {
    const connection = live.get(id)
    if (!connection || connection.sending || read(id).state !== "ready") return
    const next = db
      .query<
        { id: string; text: string },
        [string]
      >("SELECT id,text FROM prompt WHERE run=? AND status='queued' ORDER BY rowid LIMIT 1")
      .get(id)
    if (!next) return
    connection.sending = true
    try {
      await deliver(id, next)
    } catch (error) {
      update(id, { state: "unknown", detail: String(error) })
    } finally {
      connection.sending = false
      void delegation.flush(id).catch(() => {})
    }
  }
  const service = {
    memoryOwners() {
      const seen = new Set<number>()
      const active = [...live.entries()].flatMap(([id, connection]) => {
        const run = read(id)
        const pid = connection.wire.pid
        const shared = pid !== undefined && seen.has(pid)
        if (pid !== undefined) seen.add(pid)
        return [
          {
            id,
            title: `${run.driver} · ${id}`,
            pid: shared ? null : (pid ?? null),
            rootPID: pid ?? null,
            shared,
            tasksLimited: tasks.memoryLimited(id),
            tasks: tasks.memory(id).map((task) => ({
              id: task.id,
              title: task.title,
              processID: task.processID ?? undefined,
            })),
          },
        ]
      })
      const idle = supervisor
        .snapshot()
        .filter((runtime) => runtime.owners.length === 0 && runtime.pid !== undefined)
        .map((runtime) => ({
          id: `runtime:${runtime.generation}`,
          title: `${runtime.label} · idle`,
          pid: runtime.pid ?? null,
          rootPID: runtime.pid ?? null,
          shared: false,
          tasksLimited: false,
          tasks: [],
        }))
      return [...active, ...idle]
    },
    metrics() {
      return db
        .query<{ id: string; data: string }, []>("SELECT id,data FROM metric WHERE reported=0 ORDER BY rowid LIMIT 200")
        .all()
        .map((row) => Schema.decodeUnknownSync(Schema.fromJsonString(UsageReporter.Record))(row.data))
    },
    acknowledgeMetric(id: string) {
      db.query("UPDATE metric SET reported=1 WHERE id=?").run(id)
    },
    list: () => ({
      providers: providerInstances().map(provider),
      runs: runs().map((run) => ({
        ...run,
        queued: queued(run.id),
      })),
    }),
    async configure(input: Harness.Config) {
      const id = input.id ?? defaultInstanceID(input.driver)
      const current = db
        .query<ProviderInstance, [string]>(
          "SELECT id,driver,label,executable,home,credential_revision,configured,idle_timeout_ms FROM provider_instance WHERE id=?",
        )
        .get(id)
      if (current && current.driver !== input.driver) throw new Error("Provider instance ID belongs to another driver")
      if (
        runs().some(
          (run) =>
            run.driver === input.driver &&
            (run.providerInstanceID ?? defaultInstanceID(run.driver)) === id &&
            live.has(run.id),
        )
      )
        throw new Error("Close this provider instance's harnesses before changing its configuration")
      const home = input.home ?? null
      const revision =
        current && current.executable === input.executable && current.home === home
          ? current.credential_revision
          : (current?.credential_revision ?? 0) + 1
      if (current) await supervisor.evict(JSON.stringify([current.id, current.credential_revision]))
      db.query(
        `INSERT OR REPLACE INTO provider_instance(
          id,driver,label,executable,home,credential_revision,configured,idle_timeout_ms
        ) VALUES (?,?,?,?,?,?,1,?)`,
      ).run(
        id,
        input.driver,
        input.label ?? current?.label ?? "Default",
        input.executable,
        home,
        revision,
        input.idleTimeoutMs ?? current?.idle_timeout_ms ?? 60_000,
      )
      providers.delete(id)
      return probe(input.driver, id)
    },
    probe,
    probeInstance: (providerInstanceID: string) => {
      const instance = providerInstanceForKey(providerInstanceID)
      return probe(instance.driver, instance.id)
    },
    async install(driver: Harness.Driver) {
      if (runs().some((run) => run.driver === driver && live.has(run.id)))
        throw new Error("Close active harnesses before installing this provider")
      await call(
        "npm",
        ["install", "--global", agentRuntime(driver).installPackage],
        300_000,
      )
      return probe(driver)
    },
    async login(providerInstanceID: string): Promise<Harness.Login> {
      const instance = providerInstanceForKey(providerInstanceID)
      const driver = instance.driver
      const loginID = instance.id
      if (logins.get(loginID)?.state === "pending") return logins.get(loginID)!
      if (
        runs().some(
          (run) => (run.providerInstanceID ?? defaultInstanceID(run.driver)) === loginID && live.has(run.id),
        )
      )
        throw new Error("Close this provider instance's harnesses before signing in")
      const attempt = crypto.randomUUID()
      const owns = () => loginWires.get(loginID)?.id === attempt
      logins.set(loginID, { providerInstanceID: loginID, driver, state: "pending" })
      if (driver === "codex") {
        const connection = wire({
          executable: instance.executable,
          args: ["app-server"],
          directory: process.cwd(),
          environment: runtimeEnvironment(instance),
          frame: (value) => {
            if (!owns() || value.method !== "account/login/completed") return
            const params = object(value.params)
            logins.set(loginID, {
              providerInstanceID: loginID,
              driver,
              state: params.success ? "complete" : "failed",
              detail: string(params.error) || undefined,
            })
            if (params.success) advanceCredentialRevision(loginID)
            loginWires.get(loginID)?.close()
            loginWires.delete(loginID)
          },
          exit: () => {
            if (owns() && logins.get(loginID)?.state === "pending")
              logins.set(loginID, {
                providerInstanceID: loginID,
                driver,
                state: "failed",
                detail: "Sign-in process ended",
              })
          },
        })
        const timer = setTimeout(() => {
          if (!owns()) return
          logins.set(loginID, {
            providerInstanceID: loginID,
            driver,
            state: "failed",
            detail: "Sign-in timed out",
          })
          connection.close()
          loginWires.delete(loginID)
        }, 300_000)
        loginWires.set(loginID, {
          id: attempt,
          close: () => {
            clearTimeout(timer)
            return connection.close()
          },
        })
        try {
          await CodexRuntimeProtocol.initialize(connection, app.version, false)
          const result = await connection.request("account/login/start", { type: "chatgptDeviceCode" }, driver)
          if (owns() && logins.get(loginID)?.state === "pending")
            logins.set(loginID, {
              providerInstanceID: loginID,
              driver,
              state: "pending",
              url: string(result.verificationUrl) || undefined,
              code: string(result.userCode) || undefined,
            })
        } catch (error) {
          if (!owns()) return logins.get(loginID)!
          loginWires.get(loginID)?.close()
          loginWires.delete(loginID)
          logins.set(loginID, { providerInstanceID: loginID, driver, state: "failed", detail: String(error) })
        }
      }
      if (driver === "claude") {
        const child = spawn(instance.executable, ["auth", "login"], {
          env: { ...process.env, ...runtimeEnvironment(instance) },
          windowsHide: true,
        })
        const timer = setTimeout(() => {
          if (!owns()) return
          void stopOwnedProcess(child)
          logins.set(loginID, {
            providerInstanceID: loginID,
            driver,
            state: "failed",
            detail: "Sign-in timed out",
          })
        }, 300_000)
        loginWires.set(loginID, {
          id: attempt,
          close: () => {
            clearTimeout(timer)
            return stopOwnedProcess(child)
          },
          answer: (code) => {
            if (!child.stdin?.writable) throw new Error("Sign-in input is unavailable")
            child.stdin.write(code + "\n")
          },
        })
        const link = (chunk: Buffer) => {
          if (!owns()) return
          const url = chunk.toString().match(/https:\/\/[^\s\x1b]+/)?.[0]
          if (url) logins.set(loginID, { providerInstanceID: loginID, driver, state: "pending", url })
        }
        child.stdout?.on("data", link)
        child.stderr?.on("data", link)
        child.on("error", () => {
          if (!owns()) return
          clearTimeout(timer)
          logins.set(loginID, {
            providerInstanceID: loginID,
            driver,
            state: "failed",
            detail: "Unable to start Claude sign-in",
          })
          loginWires.delete(loginID)
        })
        child.on("exit", (code) => {
          if (!owns()) return
          clearTimeout(timer)
          logins.set(loginID, {
            providerInstanceID: loginID,
            driver,
            state: code === 0 ? "complete" : "failed",
          })
          if (code === 0) advanceCredentialRevision(loginID)
          loginWires.delete(loginID)
        })
      }
      return logins.get(loginID)!
    },
    loginStatus(providerInstanceID: string): Harness.Login {
      const instance = providerInstanceForKey(providerInstanceID)
      return (
        logins.get(instance.id) ?? {
          providerInstanceID: instance.id,
          driver: instance.driver,
          state: "failed",
          detail: "No sign-in in progress",
        }
      )
    },
    loginAnswer(providerInstanceID: string, code: string) {
      const instance = providerInstanceForKey(providerInstanceID)
      const login = loginWires.get(instance.id)
      if (logins.get(instance.id)?.state !== "pending" || !login?.answer)
        throw new Error("No pending authorization-code prompt on this host")
      login.answer(code)
    },
    async cancelLogin(providerInstanceID: string) {
      const instance = providerInstanceForKey(providerInstanceID)
      logins.set(instance.id, {
        providerInstanceID: instance.id,
        driver: instance.driver,
        state: "failed",
        detail: "Sign-in cancelled",
      })
      const connection = loginWires.get(instance.id)
      loginWires.delete(instance.id)
      await connection?.close()
    },
    async open(input: Harness.Open) {
      const instance = providerInstance(input.driver, input.providerInstanceID)
      const run: Harness.Run = {
        ...input,
        providerInstanceID: instance.id,
        directory: AbsolutePath.make(await realpath(input.directory)),
        id: crypto.randomUUID(),
        state: "starting",
        createdAt: new Date().toISOString(),
        queued: 0,
        capabilities: harnessCapabilities(agentRuntime(input.driver)),
      }
      write(run)
      return launch(run)
    },
    read(id: string): Harness.Detail {
      const events = db
        .query<
          { cursor: number; kind: "text" | "activity" | "error"; text: string },
          [string]
        >("SELECT cursor,kind,text FROM (SELECT cursor,kind,text FROM event WHERE run=? ORDER BY cursor DESC LIMIT 200) ORDER BY cursor")
        .all(id)
      return { run: { ...read(id), queued: queued(id) }, events, requests: requests(id), tasks: tasks.list(id) }
    },
    async prompt(id: string, input: Harness.Prompt) {
      const existing = db.query<{ run: string }, [string]>("SELECT run FROM prompt WHERE id=?").get(input.id)
      if (existing) {
        if (existing.run !== id) throw new Error("Input identity belongs to another run")
        return
      }
      const run = read(id)
      if (!live.has(id) || ["closed", "failed", "unknown", "starting"].includes(run.state))
        throw new Error("Harness is not ready; resume it explicitly")
      const busy = run.state === "running" || run.state === "waiting"
      if (busy && input.delivery === "steer" && !run.capabilities.steer)
        throw new Error("This harness does not support active steering; queue the instruction")
      db.query("INSERT INTO prompt VALUES (?,?,?,?)").run(input.id, id, input.text, "queued")
      if (!busy || input.delivery === "steer") await deliver(id, input, busy)
    },
    async interrupt(id: string) {
      const run = read(id)
      const connection = live.get(id)
      if (!connection) throw new Error("Harness process is unavailable")
      db.query("UPDATE harness_process SET eligible=0 WHERE run=?").run(id)
      connection.tools?.cancel()
      db.query("UPDATE prompt SET status='cancelled' WHERE run=? AND status='queued'").run(id)
      await agentRuntime(run.driver).interrupt({ run, turn: connection.turn, wire: connection.wire })
      connection.pending.clear()
      update(id, { state: "interrupted" })
    },
    answer(id: string, input: Harness.Answer) {
      const run = read(id)
      const connection = live.get(id)
      const item = connection?.pending.get(input.request)
      if (!connection || !item || run.state !== "waiting")
        throw new Error("Request is no longer pending on this harness")
      if (item.request.kind === "unsupported" && input.allow) throw new Error("Unsupported requests cannot be approved")
      if (
        item.request.kind === "question" &&
        input.allow &&
        item.request.questions.some((question) => !input.answers[question.id]?.trim())
      )
        throw new Error("Answer every question before submitting")
      agentRuntime(run.driver).answer({ answer: input, item, wire: connection.wire })
      connection.pending.delete(input.request)
      update(id, { state: connection.pending.size ? "waiting" : "running" })
    },
    async resume(id: string) {
      const run = read(id)
      if (run.state === "unknown") throw new Error("Confirm that the original process stopped before resuming")
      if (!run.nativeID) throw new Error("No native resume identity was recorded; start a new harness")
      if (live.has(id) && ["ready", "interrupted"].includes(run.state)) {
        db.query("UPDATE harness_process SET eligible=? WHERE run=? AND owner_token=?").run(
          run.delegation ? 1 : 0,
          id,
          ownerToken,
        )
        const next = update(id, { state: "ready" })
        void drain(id)
        void delegation.flush(id).catch(() => {})
        return next
      }
      const next = await launch(run)
      void drain(id)
      void delegation.flush(id).catch(() => {})
      return next
    },
    async close(id: string) {
      if (read(id).state === "unknown" && !live.has(id))
        throw new Error(
          "No owned process can be stopped. Reconcile the original process before releasing this checkout",
        )
      update(id, { state: "closed" })
      db.query("UPDATE harness_process SET eligible=0 WHERE run=?").run(id)
      live.get(id)?.tools?.cancel()
      db.query("UPDATE prompt SET status='cancelled' WHERE run=? AND status='queued'").run(id)
      await live.get(id)?.release()
      live.delete(id)
    },
    reconcile(id: string) {
      if (read(id).state !== "unknown" || live.has(id))
        throw new Error("Only an unowned, unknown execution can be reconciled")
      return update(id, {
        state: "interrupted",
        detail: "Operator confirmed the original process is stopped. Ambiguous input is not replayed.",
      })
    },
    assertCheckoutIdle(directory: string) {
      if (runs().some((run) => run.directory === directory && (live.has(run.id) || run.state === "unknown")))
        throw new Error("Close or reconcile this checkout's harness before changing its Git state")
    },
    async dispose() {
      live.forEach((_connection, id) => tasks.unavailable(id))
      lifetime.closed = true
      if (recoveryTimer) clearTimeout(recoveryTimer)
      const stopping = delegation.stop()
      const logins = [...loginWires.values()]
      loginWires.clear()
      await Promise.all(logins.map((connection) => connection.close()))
      await Promise.all([...live.values()].map((connection) => connection.release()))
      live.clear()
      await supervisor.dispose()
      await Promise.allSettled([...recovering])
      await stopping
      harnessOwners.delete(ownerToken)
      db.close()
    },
  }
  const delegation = createHarnessDelegation(db, {
    parent: (id) => {
      const run = read(id)
      if (!live.has(id) || !["running", "waiting"].includes(run.state))
        throw new Error("Delegation requires an active owned harness run")
      return run
    },
    configured: (driver) =>
      !!db.query("SELECT driver FROM provider_instance WHERE driver=? AND configured=1").get(driver),
    open: async (id, parent, driver) => {
      const run: Harness.Run = {
        id,
        driver,
        providerInstanceID: defaultInstanceID(driver),
        directory: parent.directory,
        state: "starting",
        createdAt: new Date().toISOString(),
        queued: 0,
        capabilities: harnessCapabilities(agentRuntime(driver)),
      }
      write(run)
      await launch(run)
    },
    prompt: (id, text) => service.prompt(id, { id: `delegation:${id}`, text, delivery: "queue" }),
    read: service.read,
    interrupt: service.interrupt,
    ...(native?.start && native.run && native.interrupt
      ? {
          native: {
            start: native.start,
            run: native.run,
            recover: native.recover ?? (async () => undefined),
            interrupt: native.interrupt,
          },
        }
      : {}),
    deliver: async (parent, id, result) => {
      if (lifetime.closed) return false
      if (parent.startsWith("session:")) {
        if (!native) return false
        await native.deliver(parent.slice("session:".length), id, result)
        return true
      }
      const connection = live.get(parent)
      if (!connection || connection.sending || read(parent).state !== "ready" || queued(parent) !== 0) return false
      const receipt = createHash("sha256").update(id).digest("hex")
      await service.prompt(parent, {
        id: `delegation-result:${receipt}`,
        text: `<delegated_task_result>\n${result}\n</delegated_task_result>`,
        delivery: "queue",
      })
      return (
        db
          .query<{ status: string }, [string]>("SELECT status FROM prompt WHERE id=?")
          .get(`delegation-result:${receipt}`)?.status === "sent"
      )
    },
  })
  // Preserve startup roots before a durable outbox can be acknowledged by flushNative.
  const recoveryAtStartup = delegation.recoverySessions()
  delegation.flushNative()
  const recoverParents = () => {
    if (lifetime.closed) return false
    let pending = false
    for (const id of delegation.recoverableParents()) {
      const run = read(id)
      if (run.state !== "unknown" || !run.nativeID || !run.delegation || live.has(id)) continue
      const owner = processOwner(id)
      if (!owner || !owner.eligible || owner.host !== localHost || ownerAlive(owner, localHost)) continue
      // No PID means a crash between spawn and recording ownership. Never guess.
      if (!owner.child_pid) continue
      if (processAlive(owner.child_pid)) {
        pending = true
        continue
      }
      const claimed = db
        .query(
          "UPDATE harness_process SET owner_pid=?,owner_token=? WHERE run=? AND owner_token=? AND child_pid=? AND eligible=1",
        )
        .run(process.pid, ownerToken, id, owner.owner_token, owner.child_pid)
      if (!claimed.changes) continue
      pending = true
      const work = (async () => {
        try {
          await launch(run)
          if (lifetime.closed) return
          void drain(id)
          await delegation.flush(id)
        } catch (error) {
          if (!lifetime.closed) {
            update(id, {
              state: "unknown",
              detail: `Automatic resume failed: ${error instanceof Error ? error.message : String(error)}`,
            })
            db.query("UPDATE harness_process SET owner_token=? WHERE run=? AND owner_token=?").run(
              `${ownerToken}:released`,
              id,
              ownerToken,
            )
          }
        }
      })()
      recovering.add(work)
      void work.finally(() => recovering.delete(work))
    }
    return pending
  }
  const scheduleRecovery = () => {
    if (recoveryTimer || lifetime.closed) return
    recoveryTimer = setTimeout(() => {
      recoveryTimer = undefined
      if (recoverParents() || recovering.size > 0) scheduleRecovery()
    }, 3000)
    recoveryTimer.unref?.()
  }
  const recoverDelegations = () => {
    delegation.recoverNative()
    if (recoverParents() || recovering.size > 0) scheduleRecovery()
  }
  return Object.assign(service, {
    delegate: delegation.delegate,
    delegationStatus: delegation.status,
    cancelDelegation: delegation.cancel,
    recoverDelegations,
    recoverySessions: () => [...new Set([...recoveryAtStartup, ...delegation.recoverySessions()])],
    delegateFromSession: (sessionID: string, directory: string, request: ExternalDelegation.Request) =>
      delegation.delegate(`session:${sessionID}`, request, { directory: AbsolutePath.make(directory) }),
    sessionDelegationStatus: (sessionID: string, taskID: string) => delegation.status(`session:${sessionID}`, taskID),
    cancelSessionDelegation: (sessionID: string, taskID: string) => delegation.cancel(`session:${sessionID}`, taskID),
  })
}

export class Service extends Context.Service<Service, Awaited<ReturnType<typeof createHarnesses>>>()(
  "@opencode/Harnesses",
) {}
const layer = (options: { sessionDelegation: boolean }) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const global = yield* Global.Service
      const app = yield* App.Metadata
      const sessions = yield* Session.Service
      const store = yield* SessionStore.Service
      const gateway = yield* ExternalDelegation.Service
      const service = yield* Effect.acquireRelease(
        Effect.promise(() =>
          createHarnesses(path.join(global.state, "harnesses"), app, {
            deliver: async (sessionID, requestID, result) => {
              if (!options.sessionDelegation) throw new Error("Native harness delegation is unavailable on this server")
              const id = Session.ID.make(sessionID)
              const session = await Effect.runPromise(sessions.get(id))
              const active = await Effect.runPromise(sessions.active)
              await Effect.runPromise(
                sessions.synthetic({
                  sessionID: id,
                  id: SessionMessage.ID.make(`msg_external_${createHash("sha256").update(requestID).digest("hex")}`),
                  description: "Delegated task result",
                  text: `<delegated_task_result>\n${result}\n</delegated_task_result>`,
                  metadata: { source: "external-delegation", taskID: requestID },
                  ...(session.outcome === "interrupted" && !active.has(id) ? { resume: false } : {}),
                }),
              )
            },
            start: async (parent, child, directory, task) => {
              const sessionID = Session.ID.make(child)
              await Effect.runPromise(
                sessions.create({
                  id: sessionID,
                  location: Location.Ref.make({ directory: AbsolutePath.make(directory) }),
                  title: "Delegated task",
                  metadata: { externalDelegationParent: parent },
                  permissions: [{ action: "*", resource: "*", effect: "ask" }],
                }),
              )
              await Effect.runPromise(
                sessions.prompt({
                  sessionID,
                  id: SessionMessage.ID.make(`msg_external_prompt_${createHash("sha256").update(child).digest("hex")}`),
                  text: task,
                  resume: false,
                }),
              )
            },
            run: async (child, signal) => {
              const sessionID = Session.ID.make(child)
              let failure: unknown
              try {
                await Effect.runPromise(sessions.resume(sessionID), { signal })
              } catch (error) {
                if (signal.aborted) throw error
                failure = error
                await Effect.runPromise(sessions.wait(sessionID), { signal })
              }
              const session = await Effect.runPromise(sessions.get(sessionID))
              if (failure && session.outcome !== "interrupted") throw failure
              const messages = await Effect.runPromise(sessions.messages({ sessionID, order: "desc", limit: 20 }))
              const response = messages.find(
                (message) => message.type === "assistant" && message.time.completed !== undefined,
              )
              return {
                status:
                  session.outcome === "succeeded"
                    ? "completed"
                    : session.outcome === "interrupted"
                      ? "interrupted"
                      : "failed",
                text: SubagentCompletion.text(response),
              }
            },
            recover: async (child, signal) => {
              const sessionID = Session.ID.make(child)
              const messageID = SessionMessage.ID.make(
                `msg_external_prompt_${createHash("sha256").update(child).digest("hex")}`,
              )
              for (;;) {
                const observed = await Effect.runPromise(store.observation(sessionID, messageID), { signal })
                if (!observed || observed.admission === "missing") return undefined
                // The core restart sweep owns suspended turns and preserves its retry budget.
                if (observed.execution !== "idle") {
                  await Effect.runPromise(Effect.sleep("100 millis"), { signal })
                  continue
                }
                if (!observed.outcome) {
                  if (observed.admission !== "pending") return undefined
                  // Admission was durable but execution never acquired its first claim.
                  await Effect.runPromise(sessions.resume(sessionID), { signal })
                  continue
                }
                const messages = await Effect.runPromise(sessions.messages({ sessionID, order: "desc", limit: 20 }), {
                  signal,
                })
                const response = messages.find(
                  (message) => message.type === "assistant" && message.time.completed !== undefined,
                )
                return {
                  status:
                    observed.outcome === "succeeded"
                      ? "completed"
                      : observed.outcome === "interrupted"
                        ? "interrupted"
                        : "failed",
                  text: SubagentCompletion.text(response),
                }
              }
            },
            interrupt: async (child) => {
              const sessionID = Session.ID.make(child)
              const interrupted = await Effect.runPromise(sessions.interrupt(sessionID))
              if (interrupted) await Effect.runPromise(sessions.wait(sessionID))
              return interrupted
            },
          }),
        ),
        (service) =>
          Effect.promise(async () => {
            gateway.set(undefined)
            await service.dispose()
          }),
      )
      if (options.sessionDelegation)
        gateway.set({
          delegate: async (sessionID, directory, request) => {
            const session = await Effect.runPromise(sessions.get(Session.ID.make(sessionID)))
            if ((await realpath(session.location.directory)) !== (await realpath(directory)))
              throw new Error("The session location changed; retry from its current checkout")
            return service.delegateFromSession(sessionID, directory, request)
          },
          status: service.sessionDelegationStatus,
          cancel: service.cancelSessionDelegation,
        })
      return service
    }),
  )
export const configured = (options: { sessionDelegation: boolean }) =>
  makeGlobalNode({
    service: Service,
    layer: layer(options),
    deps: [Global.node, App.node, Session.node, SessionStore.node, ExternalDelegation.node],
  })
export const node = configured({ sessionDelegation: true })
