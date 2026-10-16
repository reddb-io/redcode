export * as Harnesses from "./harness"

import { mkdir, realpath } from "node:fs/promises"
import path from "node:path"
import spawn from "cross-spawn"
import { Harness } from "@opencode/schema/harness"
import { UsageReporter } from "@opencode/schema/usage-reporter"
import { createHash } from "node:crypto"
import { AbsolutePath } from "@opencode/schema/schema"
import { Global } from "@opencode/util/global"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { object, string, wire, stopOwnedProcess, type Frame, type Wire } from "./harness-wire"

type Pending = { request: Harness.Request; frame: Frame }
type Live = {
  wire: Wire
  turn: string
  pending: Map<string, Pending>
  sending: boolean
  input?: string
  started?: number
}

/** Persistence belongs to the execution host. Native IDs survive restart; processes are never replayed automatically. */
export async function createHarnesses(directory: string) {
  const { Database } = await import("bun:sqlite")
  await mkdir(directory, { recursive: true })
  const db = new Database(path.join(directory, "harness.sqlite"), { create: true })
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS config (driver TEXT PRIMARY KEY, executable TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS run (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS event (cursor INTEGER PRIMARY KEY AUTOINCREMENT, run TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS event_run ON event(run,cursor);
    CREATE TABLE IF NOT EXISTS prompt (id TEXT PRIMARY KEY, run TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL);`)
  db.exec(
    "CREATE TABLE IF NOT EXISTS metric (id TEXT PRIMARY KEY, data TEXT NOT NULL, reported INTEGER NOT NULL DEFAULT 0)",
  )
  const live = new Map<string, Live>()
  const lifetime = { closed: false }
  const providers = new Map<Harness.Driver, Harness.Provider>()
  const logins = new Map<Harness.Driver, Harness.Login>()
  const loginWires = new Map<
    Harness.Driver,
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
  const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null)
  const executable = (driver: Harness.Driver) =>
    db.query<{ executable: string }, [string]>("SELECT executable FROM config WHERE driver=?").get(driver)
      ?.executable ?? driver
  runs()
    .filter((run) => !["closed", "failed", "interrupted"].includes(run.state))
    .forEach((run) =>
      write({
        ...run,
        state: "unknown",
        detail: "Host restarted. Resume explicitly; unfinished input is not replayed.",
      }),
    )

  const call = (command: string, args: string[], timeout = 15_000, codes = [0]) =>
    new Promise<string>((resolve, reject) => {
      const child = spawn(command, args, { windowsHide: true })
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
  const codexInit = async (connection: Wire) => {
    await connection.request(
      "initialize",
      { clientInfo: { name: "redcode", title: "Redcode", version: "0.78.0" } },
      "codex",
    )
    connection.send({ method: "initialized", params: {} })
  }
  const provider = (driver: Harness.Driver): Harness.Provider =>
    providers.get(driver) ?? { driver, executable: executable(driver), installed: false }
  const probe = async (driver: Harness.Driver) => {
    const file = executable(driver)
    const version = await call(file, ["--version"]).catch(() => undefined)
    if (!version) {
      const result = { driver, executable: file, installed: false }
      providers.set(driver, result)
      return result
    }
    const result = {
      driver,
      executable: file,
      installed: true,
      version,
      authenticated: undefined as boolean | undefined,
      models: undefined as Harness.Provider["models"],
    }
    if (driver === "claude") {
      const auth = await call(file, ["auth", "status", "--json"], 15_000, [0, 1]).catch(() => undefined)
      if (auth) {
        const parsed = object(JSON.parse(auth))
        result.authenticated = parsed.loggedIn === true
      }
    }
    if (driver === "codex") {
      const connection = wire({
        executable: file,
        args: ["app-server"],
        directory: process.cwd(),
        frame: () => {},
        exit: () => {},
      })
      try {
        await codexInit(connection)
        const status = await connection.request("account/read", { refreshToken: false }, driver)
        result.authenticated = status.account !== null && status.account !== undefined
        const models = await connection.request("model/list", { limit: 100 }, driver).catch(() => ({}))
        const data = object(models).data
        if (Array.isArray(data))
          result.models = data.flatMap((item) => {
            const model = object(item)
            const id = string(model.model) || string(model.id)
            return id && !model.hidden
              ? [{ id, label: string(model.displayName) || id, recommended: model.isDefault === true }]
              : []
          })
      } finally {
        await connection.close()
      }
    }
    providers.set(driver, result)
    return result
  }
  const requests = (id: string) => [...(live.get(id)?.pending.values() ?? [])].map((item) => item.request)
  const setRequest = (
    id: string,
    frame: Frame,
    key: string,
    title: string,
    detail: string,
    questions: Harness.Request["questions"],
    supported: boolean,
  ) => {
    const connection = live.get(id)
    if (!connection) return
    connection.pending.set(key, {
      frame,
      request: {
        id: key,
        kind: questions.length ? "question" : supported ? "permission" : "unsupported",
        title,
        detail,
        questions,
      },
    })
    update(id, { state: "waiting" })
  }
  const questions = (input: unknown): Harness.Request["questions"] => {
    if (!Array.isArray(input)) return []
    return input.map((item, index) => {
      const value = object(item)
      return {
        id: string(value.id) || string(value.question) || String(index),
        text: string(value.question) || string(value.header),
        options: Array.isArray(value.options)
          ? value.options.map((option) => string(object(option).label)).filter(Boolean)
          : [],
      }
    })
  }
  const frame = (id: string, value: Frame) => {
    if (lifetime.closed) return
    const run = read(id)
    const connection = live.get(id)
    if (!connection) return
    if (run.driver === "codex") {
      const params = object(value.params)
      // This process owns one thread. Ignore notifications belonging to another thread/turn.
      if (params.threadId && params.threadId !== run.nativeID) return
      if (params.turnId && connection.turn && params.turnId !== connection.turn) return
      const method = string(value.method)
      if (method === "thread/tokenUsage/updated") {
        const usage = object(object(params.tokenUsage).total)
        const cached = count(usage.cachedInputTokens)
        const input = count(usage.inputTokens)
        const output = count(usage.outputTokens)
        const reasoning = count(usage.reasoningOutputTokens)
        const tokens = {
          input: input === null || cached === null ? null : Math.max(0, input - cached),
          output: output === null || reasoning === null ? null : Math.max(0, output - reasoning),
          reasoning,
          cache: { read: cached, write: null },
        }
        // Codex total is cumulative for the native thread. Preserve it as a replaceable snapshot.
        metric(id, `usage:${JSON.stringify(tokens)}`, tokens, null, "session", "busy")
      }
      if (value.id !== undefined && method) {
        const supported = [
          "item/commandExecution/requestApproval",
          "item/fileChange/requestApproval",
          "item/tool/requestUserInput",
        ].includes(method)
        setRequest(
          id,
          value,
          String(value.id),
          method,
          string(params.reason) || string(params.command),
          questions(params.questions),
          supported,
        )
        return
      }
      if (method === "serverRequest/resolved") connection.pending.delete(String(params.requestId))
      if (method === "turn/started") {
        connection.turn = string(object(params.turn).id)
        update(id, { state: "running" })
      }
      if (method === "item/agentMessage/delta") event(id, "text", string(params.delta))
      if (method === "item/started") event(id, "activity", string(object(params.item).type))
      if (method === "turn/completed") {
        const turn = object(params.turn)
        metric(
          id,
          `turn:${string(turn.id) || connection.turn}`,
          null,
          null,
          "interaction",
          turn.status === "failed" ? "failed" : turn.status === "interrupted" ? "cancelled" : "succeeded",
        )
        connection.turn = ""
        connection.pending.clear()
        update(id, {
          state: turn.status === "failed" ? "failed" : turn.status === "interrupted" ? "interrupted" : "ready",
          detail: string(object(turn.error).message) || undefined,
        })
        void drain(id)
      }
      return
    }
    if (value.type === "control_cancel_request") {
      connection.pending.delete(string(value.request_id))
      return
    }
    if (value.type === "control_request") {
      const request = object(value.request)
      const input = object(request.input)
      const supported = request.subtype === "can_use_tool"
      setRequest(
        id,
        value,
        string(value.request_id),
        string(request.tool_name) || string(request.subtype),
        JSON.stringify(input).slice(0, 8000),
        questions(input.questions),
        supported,
      )
      return
    }
    if (value.type === "system" && value.subtype === "init")
      update(id, { nativeID: string(value.session_id) || run.nativeID })
    if (value.type === "assistant" && !value.parent_tool_use_id) {
      const message = object(value.message)
      if (Array.isArray(message.content))
        message.content.forEach((item) => {
          const block = object(item)
          if (block.type === "text") event(id, "text", string(block.text))
          if (block.type === "tool_use") event(id, "activity", string(block.name))
        })
    }
    if (value.type === "result") {
      if (string(value.session_id) && string(value.session_id) !== read(id).nativeID)
        update(id, { nativeID: string(value.session_id) })
      const usage = object(value.usage)
      const tokens = Object.keys(usage).length
        ? {
            input: count(usage.input_tokens),
            output: count(usage.output_tokens),
            reasoning: null,
            cache: { read: count(usage.cache_read_input_tokens), write: count(usage.cache_creation_input_tokens) },
          }
        : null
      const models = Object.keys(object(value.modelUsage))
      metric(
        id,
        `result:${string(value.uuid) || connection.input || "unknown"}`,
        tokens,
        null,
        "interaction",
        value.is_error ? "failed" : "succeeded",
        models.length === 1 ? models[0] : undefined,
      )
      // Streaming-input result usage is per interaction; cost/modelUsage include prior turns and subagents.
      const totals = models.map((model) => object(object(value.modelUsage)[model]))
      const sum = (field: string) =>
        totals.length && totals.every((model) => count(model[field]) !== null)
          ? totals.reduce((total, model) => total + (count(model[field]) ?? 0), 0)
          : null
      const cumulative = totals.length
        ? {
            input: sum("inputTokens"),
            output: sum("outputTokens"),
            reasoning: null,
            cache: { read: sum("cacheReadInputTokens"), write: sum("cacheCreationInputTokens") },
          }
        : null
      const cost = count(value.total_cost_usd)
      metric(
        id,
        `total:${JSON.stringify({ cumulative, cost })}`,
        cumulative,
        cost,
        "session",
        value.is_error ? "failed" : "idle",
        models.length === 1 ? models[0] : null,
        "estimated",
      )
      connection.pending.clear()
      update(id, {
        nativeID: string(value.session_id) || run.nativeID,
        state: value.is_error ? "failed" : "ready",
        detail: value.is_error ? string(value.result) || "Claude execution failed" : undefined,
      })
      void drain(id)
    }
  }
  const launch = async (run: Harness.Run) => {
    if (live.has(run.id)) throw new Error("Harness is already attached")
    const canonical = await realpath(run.directory)
    if (canonical !== run.directory) throw new Error("Checkout moved; select its current canonical path")
    update(run.id, { state: "starting", detail: undefined })
    const args =
      run.driver === "codex"
        ? ["app-server"]
        : [
            "--print",
            "--verbose",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--permission-prompt-tool",
            "stdio",
            "--permission-mode",
            "default",
            ...(run.nativeID ? ["--resume", run.nativeID] : []),
            ...(run.model ? ["--model", run.model] : []),
          ]
    const connection = wire({
      executable: executable(run.driver),
      args,
      directory: canonical,
      frame: (value) => frame(run.id, value),
      exit: (detail) => {
        if (live.get(run.id)?.wire !== connection) return
        live.delete(run.id)
        if (lifetime.closed) return
        if (read(run.id).state !== "closed") update(run.id, { state: "unknown", detail })
      },
    })
    live.set(run.id, { wire: connection, turn: "", pending: new Map(), sending: false })
    try {
      if (run.driver === "codex") {
        await codexInit(connection)
        const result = await connection.request(
          run.nativeID ? "thread/resume" : "thread/start",
          {
            ...(run.nativeID ? { threadId: run.nativeID } : {}),
            cwd: canonical,
            ...(run.model ? { model: run.model } : {}),
            approvalPolicy: "on-request",
            sandbox: "workspace-write",
          },
          run.driver,
        )
        const nativeID = string(object(result.thread).id)
        if (!nativeID) throw new Error("Codex did not return a thread identity")
        update(run.id, { nativeID })
      }
      if (run.driver === "claude") await connection.request("initialize", { hooks: {}, sdkMcpServers: [] }, run.driver)
      return update(run.id, { state: "ready" })
    } catch (error) {
      update(run.id, { state: "failed", detail: error instanceof Error ? error.message : String(error) })
      connection.close()
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
    if (run.driver === "codex") {
      const result = await connection.wire.request(
        steer ? "turn/steer" : "turn/start",
        {
          threadId: run.nativeID ?? "",
          ...(steer ? { expectedTurnId: connection.turn } : {}),
          input: [{ type: "text", text: prompt.text, text_elements: [] }],
        },
        run.driver,
      )
      if (!steer) connection.turn = string(object(result.turn).id)
    }
    if (run.driver === "claude")
      connection.wire.send({
        type: "user",
        uuid: prompt.id,
        session_id: run.nativeID ?? "",
        message: { role: "user", content: prompt.text },
        parent_tool_use_id: null,
      })
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
    }
  }
  const service = {
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
      providers: (["claude", "codex"] as const).map(provider),
      runs: runs().map((run) => ({
        ...run,
        queued: queued(run.id),
      })),
    }),
    async configure(input: Harness.Config) {
      if (runs().some((run) => run.driver === input.driver && live.has(run.id)))
        throw new Error("Close this provider's harnesses before changing its executable")
      db.query("INSERT OR REPLACE INTO config VALUES (?,?)").run(input.driver, input.executable)
      return probe(input.driver)
    },
    probe,
    async install(driver: Harness.Driver) {
      if (runs().some((run) => run.driver === driver && live.has(run.id)))
        throw new Error("Close active harnesses before installing this provider")
      await call(
        "npm",
        ["install", "--global", driver === "claude" ? "@anthropic-ai/claude-code" : "@openai/codex"],
        300_000,
      )
      return probe(driver)
    },
    async login(driver: Harness.Driver): Promise<Harness.Login> {
      if (logins.get(driver)?.state === "pending") return logins.get(driver)!
      const attempt = crypto.randomUUID()
      const owns = () => loginWires.get(driver)?.id === attempt
      logins.set(driver, { driver, state: "pending" })
      if (driver === "codex") {
        const connection = wire({
          executable: executable(driver),
          args: ["app-server"],
          directory: process.cwd(),
          frame: (value) => {
            if (!owns() || value.method !== "account/login/completed") return
            const params = object(value.params)
            logins.set(driver, {
              driver,
              state: params.success ? "complete" : "failed",
              detail: string(params.error) || undefined,
            })
            loginWires.get(driver)?.close()
            loginWires.delete(driver)
          },
          exit: () => {
            if (owns() && logins.get(driver)?.state === "pending")
              logins.set(driver, { driver, state: "failed", detail: "Sign-in process ended" })
          },
        })
        const timer = setTimeout(() => {
          if (!owns()) return
          logins.set(driver, { driver, state: "failed", detail: "Sign-in timed out" })
          connection.close()
          loginWires.delete(driver)
        }, 300_000)
        loginWires.set(driver, {
          id: attempt,
          close: () => {
            clearTimeout(timer)
            return connection.close()
          },
        })
        try {
          await codexInit(connection)
          const result = await connection.request("account/login/start", { type: "chatgptDeviceCode" }, driver)
          if (owns() && logins.get(driver)?.state === "pending")
            logins.set(driver, {
              driver,
              state: "pending",
              url: string(result.verificationUrl) || undefined,
              code: string(result.userCode) || undefined,
            })
        } catch (error) {
          if (!owns()) return logins.get(driver)!
          loginWires.get(driver)?.close()
          loginWires.delete(driver)
          logins.set(driver, { driver, state: "failed", detail: String(error) })
        }
      }
      if (driver === "claude") {
        const child = spawn(executable(driver), ["auth", "login"], { windowsHide: true })
        const timer = setTimeout(() => {
          if (!owns()) return
          void stopOwnedProcess(child)
          logins.set(driver, { driver, state: "failed", detail: "Sign-in timed out" })
        }, 300_000)
        loginWires.set(driver, {
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
          if (url) logins.set(driver, { driver, state: "pending", url })
        }
        child.stdout?.on("data", link)
        child.stderr?.on("data", link)
        child.on("error", () => {
          if (!owns()) return
          clearTimeout(timer)
          logins.set(driver, { driver, state: "failed", detail: "Unable to start Claude sign-in" })
          loginWires.delete(driver)
        })
        child.on("exit", (code) => {
          if (!owns()) return
          clearTimeout(timer)
          logins.set(driver, { driver, state: code === 0 ? "complete" : "failed" })
          loginWires.delete(driver)
        })
      }
      return logins.get(driver)!
    },
    loginStatus: (driver: Harness.Driver): Harness.Login =>
      logins.get(driver) ?? { driver, state: "failed", detail: "No sign-in in progress" },
    loginAnswer(driver: Harness.Driver, code: string) {
      const login = loginWires.get(driver)
      if (logins.get(driver)?.state !== "pending" || !login?.answer)
        throw new Error("No pending authorization-code prompt on this host")
      login.answer(code)
    },
    async cancelLogin(driver: Harness.Driver) {
      logins.set(driver, { driver, state: "failed", detail: "Sign-in cancelled" })
      const connection = loginWires.get(driver)
      loginWires.delete(driver)
      await connection?.close()
    },
    async open(input: Harness.Open) {
      const run: Harness.Run = {
        ...input,
        directory: AbsolutePath.make(await realpath(input.directory)),
        id: crypto.randomUUID(),
        state: "starting",
        createdAt: new Date().toISOString(),
        queued: 0,
        capabilities: { steer: input.driver === "codex", resume: true, interrupt: true },
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
      return { run: { ...read(id), queued: queued(id) }, events, requests: requests(id) }
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
      db.query("UPDATE prompt SET status='cancelled' WHERE run=? AND status='queued'").run(id)
      if (run.driver === "codex" && connection.turn)
        await connection.wire.request(
          "turn/interrupt",
          { threadId: run.nativeID ?? "", turnId: connection.turn },
          run.driver,
        )
      if (run.driver === "claude") await connection.wire.request("interrupt", {}, run.driver)
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
      if (run.driver === "codex") {
        const result: Frame =
          item.request.kind === "question"
            ? {
                answers: Object.fromEntries(
                  item.request.questions.map((question) => [
                    question.id,
                    { answers: input.allow ? [input.answers[question.id] ?? ""] : [] },
                  ]),
                ),
              }
            : { decision: input.allow ? "accept" : "decline" }
        connection.wire.send(
          item.request.kind === "unsupported"
            ? { id: item.frame.id ?? input.request, error: { code: -32601, message: "Unsupported by Redcode" } }
            : { id: item.frame.id ?? input.request, result },
        )
      }
      if (run.driver === "claude") {
        const request = object(item.frame.request)
        connection.wire.send({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: input.request,
            response: input.allow
              ? {
                  behavior: "allow",
                  updatedInput: {
                    ...object(request.input),
                    ...(item.request.kind === "question" ? { answers: input.answers } : {}),
                  },
                }
              : { behavior: "deny", message: "Declined by user" },
          },
        })
      }
      connection.pending.delete(input.request)
      update(id, { state: connection.pending.size ? "waiting" : "running" })
    },
    async resume(id: string) {
      const run = read(id)
      if (run.state === "unknown") throw new Error("Confirm that the original process stopped before resuming")
      if (!run.nativeID) throw new Error("No native resume identity was recorded; start a new harness")
      if (live.has(id) && ["ready", "interrupted"].includes(run.state)) {
        const next = update(id, { state: "ready" })
        void drain(id)
        return next
      }
      const next = await launch(run)
      void drain(id)
      return next
    },
    async close(id: string) {
      if (read(id).state === "unknown" && !live.has(id))
        throw new Error(
          "No owned process can be stopped. Reconcile the original process before releasing this checkout",
        )
      update(id, { state: "closed" })
      db.query("UPDATE prompt SET status='cancelled' WHERE run=? AND status='queued'").run(id)
      await live.get(id)?.wire.close()
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
      lifetime.closed = true
      const logins = [...loginWires.values()]
      loginWires.clear()
      await Promise.all(logins.map((connection) => connection.close()))
      await Promise.all([...live.values()].map((connection) => connection.wire.close()))
      live.clear()
      db.close()
    },
  }
  return service
}

export class Service extends Context.Service<Service, Awaited<ReturnType<typeof createHarnesses>>>()(
  "@opencode/Harnesses",
) {}
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const global = yield* Global.Service
    return yield* Effect.acquireRelease(
      Effect.promise(() => createHarnesses(path.join(global.state, "harnesses"))),
      (service) => Effect.promise(() => service.dispose()),
    )
  }),
)
export const node = makeGlobalNode({ service: Service, layer, deps: [Global.node] })
