import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { writeFile, chmod } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { createHarnesses } from "../src/harness"
import { Harness } from "@opencode/schema/harness"
import { AbsolutePath } from "@opencode/schema/schema"
import { Schema } from "effect"
import { App } from "@opencode/core/app"

const fixture = path.resolve(import.meta.dir, "fixture/harness-process.ts")
async function executable(root: string, driver: Harness.Driver, modelsError = false) {
  const file = path.join(root, driver + (process.platform === "win32" ? ".cmd" : ".sh"))
  await writeFile(
    file,
    process.platform === "win32"
      ? `@"${process.execPath}" "${fixture}" ${driver} "${path.join(root, "wire.jsonl")}" ${modelsError ? "models-error" : ""} %*\r\n`
      : `#!/bin/sh\nexec '${process.execPath}' '${fixture}' ${driver} '${path.join(root, "wire.jsonl")}' ${modelsError ? "models-error" : ""} "$@"\n`,
  )
  await chmod(file, 0o700)
  return file
}
async function until(check: () => boolean | Promise<boolean>) {
  const end = Date.now() + 5000
  while (!(await check())) {
    if (Date.now() > end) throw new Error("Protocol did not settle")
    await Bun.sleep(10)
  }
}

for (const parentDriver of ["codex", "claude"] as const) {
  test(`${parentDriver} exposes opt-in delegation through its native tool transport`, async () => {
    await using tmp = await tmpdir("redcode-harness-delegation-tool-")
    const service = await createHarnesses(path.join(tmp.path, "state"))
    const target = parentDriver === "codex" ? "claude" : "codex"
    try {
      await service.configure({ driver: parentDriver, executable: await executable(tmp.path, parentDriver) })
      await service.configure({ driver: target, executable: await executable(tmp.path, target) })
      const parent = await service.open({
        driver: parentDriver,
        directory: AbsolutePath.make(tmp.path),
        delegation: true,
      })
      await service.prompt(parent.id, { id: "delegate-tool-input", text: `delegate:${target}`, delivery: "queue" })
      await until(() => service.read(parent.id).run.state === "ready")
      const response = service.read(parent.id).events.find((event) => event.text.startsWith("DELEGATE_RESULT "))
      expect(response).toBeDefined()
      await until(() => service.delegationStatus(parent.id, "fixture-delegation").status === "completed")
      expect(service.delegationStatus(parent.id, "fixture-delegation")).toMatchObject({
        driver: target,
        status: "completed",
      })
      await until(() => service.read(parent.id).events.filter((event) => event.text === "fixture response").length >= 2)
      const capture = await Bun.file(path.join(tmp.path, "wire.jsonl")).text()
      expect(capture).toContain(parentDriver === "codex" ? '"redcode_delegate_task"' : '"sdkMcpServers":["redcode"]')
      expect(capture).toContain("redcode_task_status")
      expect(capture).toContain("<delegated_task_result>")
    } finally {
      await service.dispose()
    }
  }, 30_000)

  test(`${parentDriver} delegates to the other configured harness and retains ownership`, async () => {
    await using tmp = await tmpdir("redcode-harness-delegation-")
    const directory = path.join(tmp.path, "state")
    const service = await createHarnesses(directory)
    const target = parentDriver === "codex" ? "claude" : "codex"
    let parentID = ""
    try {
      await service.configure({ driver: parentDriver, executable: await executable(tmp.path, parentDriver) })
      const parent = await service.open({ driver: parentDriver, directory: AbsolutePath.make(tmp.path) })
      parentID = parent.id
      await service.prompt(parent.id, { id: "parent-hold", text: "hold", delivery: "queue" })
      await until(() => service.read(parent.id).run.state === "running")
      await expect(
        service.delegate(parent.id, { requestID: "unconfigured", driver: target, task: "review" }),
      ).rejects.toThrow("not configured")
      await service.configure({ driver: target, executable: await executable(tmp.path, target) })
      const launched = await service.delegate(parent.id, { requestID: "review-1", driver: target, task: "review" })
      await until(() => service.delegationStatus(parent.id, "review-1").status === "completed")
      expect(service.delegationStatus(parent.id, "review-1")).toMatchObject({
        taskID: "review-1",
        childID: launched.childID,
        driver: target,
        status: "completed",
        events: expect.arrayContaining([expect.objectContaining({ kind: "text", text: "fixture response" })]),
      })
      const initial = service.delegationStatus(parent.id, "review-1")
      await service.prompt(launched.childID, { id: "later-follow-up", text: "review again", delivery: "queue" })
      await until(() => service.read(launched.childID).run.state === "ready")
      expect(service.delegationStatus(parent.id, "review-1")).toEqual(initial)
      const retried = await service.delegate(parent.id, {
        requestID: "review-1",
        driver: parentDriver,
        task: "different",
      })
      expect(retried.childID).toBe(launched.childID)
      expect(service.list().runs.filter((run) => run.id === launched.childID)).toHaveLength(1)
      expect(() => service.delegationStatus("foreign-parent", "review-1")).toThrow("not found")
      const held = await service.delegate(parent.id, { requestID: "hold-1", driver: target, task: "hold" })
      await until(() => service.delegationStatus(parent.id, "hold-1").status === "running")
      expect((await service.cancelDelegation(parent.id, "hold-1")).status).toBe("interrupted")
      expect(held.childID).not.toBe(launched.childID)
      await service.delegate(parent.id, { requestID: "restart-1", driver: target, task: "hold" })
      await until(() => service.delegationStatus(parent.id, "restart-1").status === "running")
      expect(await Bun.file(path.join(tmp.path, "wire.jsonl")).text()).not.toContain("<delegated_task_result>")
      await service.interrupt(parent.id)
      expect(await Bun.file(path.join(tmp.path, "wire.jsonl")).text()).not.toContain("<delegated_task_result>")
      await service.resume(parent.id)
      await until(() => service.read(parent.id).events.some((event) => event.text === "fixture response"))
      expect(await Bun.file(path.join(tmp.path, "wire.jsonl")).text()).toContain("<delegated_task_result>")
    } finally {
      await service.dispose()
    }
    const recovered = await createHarnesses(directory)
    try {
      expect(recovered.delegationStatus(parentID, "review-1")).toMatchObject({ status: "completed", driver: target })
      expect(recovered.delegationStatus(parentID, "restart-1")).toMatchObject({ status: "unknown", driver: target })
      expect(() => recovered.delegationStatus("foreign-parent", "review-1")).toThrow("not found")
    } finally {
      await recovered.dispose()
    }
  }, 30_000)
}

test("native parent receives a durable external result and retries failed delivery after restart", async () => {
  await using tmp = await tmpdir("redcode-native-delegation-")
  const directory = path.join(tmp.path, "state")
  const delivered: Array<{ session: string; request: string; result: string }> = []
  const service = await createHarnesses(directory, App.make({ name: "redcode" }), {
    deliver: async (session, request, result) => {
      if (request === "retry") throw new Error("delivery unavailable")
      delivered.push({ session, request, result })
    },
  })
  try {
    await service.configure({ driver: "codex", executable: await executable(tmp.path, "codex") })
    const first = await service.delegateFromSession("ses_parent", tmp.path, {
      requestID: "first",
      driver: "codex",
      task: "review",
    })
    await until(() => service.sessionDelegationStatus("ses_parent", "first").status === "completed")
    await until(() => delivered.length === 1)
    expect(delivered[0]).toMatchObject({ session: "ses_parent", request: "first" })
    expect(delivered[0].result).toContain("fixture response")
    expect(service.sessionDelegationStatus("ses_parent", "first").childID).toBe(first.childID)
    expect(() => service.sessionDelegationStatus("ses_other", "first")).toThrow("not found")
    await service.delegateFromSession("ses_parent", tmp.path, { requestID: "retry", driver: "codex", task: "review" })
    await until(() => service.sessionDelegationStatus("ses_parent", "retry").status === "completed")
  } finally {
    await service.dispose()
  }
  const recovered = await createHarnesses(directory, App.make({ name: "redcode" }), {
    deliver: async (session, request, result) => {
      delivered.push({ session, request, result })
    },
  })
  try {
    await until(() => delivered.length === 2)
    expect(delivered.map((entry) => entry.request)).toEqual(["first", "retry"])
    expect(recovered.recoverySessions()).toContain("ses_parent")
  } finally {
    await recovered.dispose()
  }
}, 30_000)

for (const driver of ["codex", "claude"] as const)
  test(`${driver} delegates to the native adapter and receives its result`, async () => {
    await using tmp = await tmpdir("redcode-harness-native-child-")
    const started: string[] = []
    const service = await createHarnesses(path.join(tmp.path, "state"), App.make({ name: "redcode" }), {
      deliver: async () => {},
      start: async (parent, child, directory, task) => {
        started.push(JSON.stringify({ parent, child, directory, task }))
      },
      run: async () => ({ status: "completed", text: "native review complete" }),
      interrupt: async () => true,
    })
    try {
      await service.configure({ driver, executable: await executable(tmp.path, driver) })
      const parent = await service.open({ driver, directory: AbsolutePath.make(tmp.path), delegation: true })
      await service.prompt(parent.id, { id: "native-child-input", text: "delegate:redcode", delivery: "queue" })
      await until(() => service.read(parent.id).events.some((event) => event.text.startsWith("DELEGATE_RESULT ")))
      await until(() => service.delegationStatus(parent.id, "fixture-delegation").status === "completed")
      await until(() => service.read(parent.id).events.filter((event) => event.text === "fixture response").length >= 2)
      const result = service.delegationStatus(parent.id, "fixture-delegation")
      expect(result).toMatchObject({
        driver: "redcode",
        status: "completed",
        events: [expect.objectContaining({ text: "native review complete" })],
      })
      expect(result.childID).toStartWith("ses_")
      expect(started).toHaveLength(1)
      expect(await Bun.file(path.join(tmp.path, "wire.jsonl")).text()).toContain("native review complete")
    } finally {
      await service.dispose()
    }
  }, 30_000)

test("a native child reconnects after host shutdown without replaying admission", async () => {
  await using tmp = await tmpdir("redcode-native-child-restart-")
  const directory = path.join(tmp.path, "state")
  const starts: string[] = []
  const service = await createHarnesses(directory, App.make({ name: "redcode" }), {
    deliver: async () => {},
    start: async (_parent, child) => {
      starts.push(child)
    },
    run: async (_child, signal) =>
      new Promise((_, reject) => {
        if (signal.aborted) return reject(new Error("shutdown"))
        signal.addEventListener("abort", () => reject(new Error("shutdown")), { once: true })
      }),
    interrupt: async () => true,
  })
  await service.configure({ driver: "codex", executable: await executable(tmp.path, "codex") })
  const active = await service.open({ driver: "codex", directory: AbsolutePath.make(tmp.path) })
  await service.prompt(active.id, { id: "hold-native-parent", text: "hold", delivery: "queue" })
  await until(() => service.read(active.id).run.state === "running")
  const child = await service.delegate(active.id, { requestID: "native-restart", driver: "redcode", task: "review" })
  expect(child.status).toBe("running")
  await service.dispose()
  const observed: string[] = []
  const recovered = await createHarnesses(directory, App.make({ name: "redcode" }), {
    deliver: async () => {},
    start: async (_parent, child) => {
      starts.push(child)
    },
    run: async () => {
      throw new Error("must not start a new execution")
    },
    recover: async (child) => {
      observed.push(child)
      return { status: "completed", text: "recovered result" }
    },
    interrupt: async () => true,
  })
  try {
    recovered.recoverDelegations()
    recovered.recoverDelegations()
    await until(() => recovered.delegationStatus(active.id, "native-restart").status === "completed")
    expect(recovered.delegationStatus(active.id, "native-restart")).toMatchObject({
      childID: child.childID,
      status: "completed",
      events: [expect.objectContaining({ text: "recovered result" })],
    })
    expect(starts).toHaveLength(1)
    expect(observed).toEqual([child.childID])
  } finally {
    await recovered.dispose()
  }
  const again = await createHarnesses(directory)
  try {
    expect(again.delegationStatus(active.id, "native-restart")).toMatchObject({
      status: "completed",
      events: [expect.objectContaining({ text: "recovered result" })],
    })
  } finally {
    await again.dispose()
  }
}, 30_000)

for (const driver of ["codex", "claude"] as const) {
  test(`${driver} parent automatically resumes and receives a recovered child result`, async () => {
    await using tmp = await tmpdir("redcode-parent-autoresume-")
    const directory = path.join(tmp.path, "state")
    const native = {
      deliver: async () => {},
      start: async () => {},
      run: async (_child: string, signal: AbortSignal): Promise<{ status: "completed"; text: string }> =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("shutdown")), { once: true }),
        ),
      recover: async () => ({ status: "completed" as const, text: "restored child result" }),
      interrupt: async () => true,
    }
    const first = await createHarnesses(directory, App.make({ name: "redcode" }), native)
    await first.configure({ driver, executable: await executable(tmp.path, driver) })
    const parent = await first.open({ driver, directory: AbsolutePath.make(tmp.path), delegation: true })
    await first.prompt(parent.id, { id: "parent-original", text: "hold", delivery: "queue" })
    await until(() => first.read(parent.id).run.state === "running" && !!first.read(parent.id).run.nativeID)
    const child = await first.delegate(parent.id, { requestID: "recovered-child", driver: "redcode", task: "review" })
    await first.dispose()
    const recovered = await createHarnesses(directory, App.make({ name: "redcode" }), native)
    try {
      recovered.recoverDelegations()
      recovered.recoverDelegations()
      await until(() => recovered.delegationStatus(parent.id, "recovered-child").status === "completed")
      await until(async () =>
        (await Bun.file(path.join(tmp.path, "wire.jsonl")).text()).includes("restored child result"),
      )
      const capture = await Bun.file(path.join(tmp.path, "wire.jsonl")).text()
      expect(capture.match(/restored child result/g)).toHaveLength(1)
      expect(recovered.delegationStatus(parent.id, "recovered-child").childID).toBe(child.childID)
      expect(recovered.read(parent.id).run.nativeID).toBe(driver === "codex" ? "thread-fixture" : "claude-fixture")
      expect(capture.match(/"hold"/g)).toHaveLength(1)
    } finally {
      await recovered.dispose()
    }
  }, 30_000)
}

test("automatic recovery waits for the previously owned harness process to exit", async () => {
  await using tmp = await tmpdir("redcode-parent-live-process-")
  const directory = path.join(tmp.path, "state")
  const native = {
    deliver: async () => {},
    start: async () => {},
    interrupt: async () => true,
    run: async (_child: string, signal: AbortSignal): Promise<{ status: "completed"; text: string }> =>
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("shutdown")), { once: true })),
    recover: async () => ({ status: "completed" as const, text: "waited result" }),
  }
  const first = await createHarnesses(directory, App.make({ name: "redcode" }), native)
  await first.configure({ driver: "codex", executable: await executable(tmp.path, "codex") })
  const parent = await first.open({ driver: "codex", directory: AbsolutePath.make(tmp.path), delegation: true })
  await first.prompt(parent.id, { id: "live-parent", text: "hold", delivery: "queue" })
  await until(() => first.read(parent.id).run.state === "running")
  await first.delegate(parent.id, { requestID: "live-child", driver: "redcode", task: "review" })
  await first.dispose()
  const db = new Database(path.join(directory, "harness.sqlite"))
  const original = db
    .query<{ child_pid: number }, [string]>("SELECT child_pid FROM harness_process WHERE run=?")
    .get(parent.id)!
  db.query("UPDATE harness_process SET child_pid=? WHERE run=?").run(process.pid, parent.id)
  const recovered = await createHarnesses(directory, App.make({ name: "redcode" }), native)
  try {
    recovered.recoverDelegations()
    await until(() => recovered.delegationStatus(parent.id, "live-child").status === "completed")
    await Bun.sleep(100)
    expect(recovered.read(parent.id).run.state).toBe("unknown")
    expect(await Bun.file(path.join(tmp.path, "wire.jsonl")).text()).not.toContain("waited result")
    db.query("UPDATE harness_process SET child_pid=? WHERE run=?").run(original.child_pid, parent.id)
    recovered.recoverDelegations()
    await until(async () => (await Bun.file(path.join(tmp.path, "wire.jsonl")).text()).includes("waited result"))
  } finally {
    db.close()
    await recovered.dispose()
  }
}, 30_000)

test("automatic recovery does not resume a parent explicitly interrupted by the user", async () => {
  await using tmp = await tmpdir("redcode-parent-stopped-")
  const directory = path.join(tmp.path, "state")
  const native = {
    deliver: async () => {},
    start: async () => {},
    interrupt: async () => true,
    run: async (_child: string, signal: AbortSignal): Promise<{ status: "completed"; text: string }> =>
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("shutdown")), { once: true })),
    recover: async () => ({ status: "completed" as const, text: "parked result" }),
  }
  const first = await createHarnesses(directory, App.make({ name: "redcode" }), native)
  await first.configure({ driver: "codex", executable: await executable(tmp.path, "codex") })
  const parent = await first.open({ driver: "codex", directory: AbsolutePath.make(tmp.path), delegation: true })
  await first.prompt(parent.id, { id: "stopped-parent", text: "hold", delivery: "queue" })
  await until(() => first.read(parent.id).run.state === "running")
  await first.delegate(parent.id, { requestID: "stopped-child", driver: "redcode", task: "review" })
  await first.interrupt(parent.id)
  await first.dispose()
  const recovered = await createHarnesses(directory, App.make({ name: "redcode" }), native)
  try {
    recovered.recoverDelegations()
    await until(() => recovered.delegationStatus(parent.id, "stopped-child").status === "completed")
    expect(recovered.read(parent.id).run.state).toBe("interrupted")
    expect(await Bun.file(path.join(tmp.path, "wire.jsonl")).text()).not.toContain("parked result")
  } finally {
    await recovered.dispose()
  }
}, 30_000)

test("automatic recovery does not replay a result whose delivery was ambiguous", async () => {
  await using tmp = await tmpdir("redcode-ambiguous-result-")
  const directory = path.join(tmp.path, "state")
  const native = {
    deliver: async () => {},
    start: async () => {},
    interrupt: async () => true,
    run: async (_child: string, signal: AbortSignal): Promise<{ status: "completed"; text: string }> =>
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("shutdown")), { once: true })),
    recover: async () => ({ status: "completed" as const, text: "ambiguous result" }),
  }
  const first = await createHarnesses(directory, App.make({ name: "redcode" }), native)
  await first.configure({ driver: "codex", executable: await executable(tmp.path, "codex") })
  const parent = await first.open({ driver: "codex", directory: AbsolutePath.make(tmp.path), delegation: true })
  await first.prompt(parent.id, { id: "ambiguous-parent", text: "hold", delivery: "queue" })
  await until(() => first.read(parent.id).run.state === "running")
  await first.delegate(parent.id, { requestID: "ambiguous-child", driver: "redcode", task: "review" })
  await first.dispose()
  const db = new Database(path.join(directory, "harness.sqlite"))
  try {
    const receipt = createHash("sha256").update("ambiguous-child").digest("hex")
    db.query("INSERT INTO prompt(id,run,text,status) VALUES (?,?,?,?)").run(
      `delegation-result:${receipt}`,
      parent.id,
      "possibly delivered",
      "admitted",
    )
  } finally {
    db.close()
  }
  const recovered = await createHarnesses(directory, App.make({ name: "redcode" }), native)
  try {
    recovered.recoverDelegations()
    await until(() => recovered.delegationStatus(parent.id, "ambiguous-child").status === "completed")
    await until(() => recovered.read(parent.id).run.state === "ready")
    await Bun.sleep(100)
    expect(await Bun.file(path.join(tmp.path, "wire.jsonl")).text()).not.toContain("ambiguous result")
  } finally {
    await recovered.dispose()
  }
}, 30_000)

test("a real foreground server resumes a parent and delivers its pending result", async () => {
  await using tmp = await tmpdir("redcode-foreground-process-")
  const state = path.join(tmp.path, "xdg-state", "opencode", "harnesses")
  const first = await createHarnesses(state, App.make({ name: "redcode" }), {
    deliver: async () => {},
    start: async () => {},
    interrupt: async () => true,
    run: async () => ({ status: "completed", text: "foreground delivery" }),
  })
  await first.configure({ driver: "codex", executable: await executable(tmp.path, "codex") })
  const parent = await first.open({ driver: "codex", directory: AbsolutePath.make(tmp.path), delegation: true })
  await first.prompt(parent.id, { id: "foreground-parent", text: "hold", delivery: "queue" })
  await until(() => first.read(parent.id).run.state === "running")
  await first.delegate(parent.id, { requestID: "foreground-child", driver: "redcode", task: "review" })
  await until(() => first.delegationStatus(parent.id, "foreground-child").status === "completed")
  await first.dispose()
  // The setup ran in this test process; model a stopped previous server process
  // using the already-reaped fixture PID before starting the new server process.
  const ownership = new Database(path.join(state, "harness.sqlite"))
  ownership.query("UPDATE harness_process SET owner_pid=child_pid WHERE run=?").run(parent.id)
  ownership.close()
  const server = Bun.spawn(
    [
      process.execPath,
      path.resolve(import.meta.dir, "fixture/foreground-restart-server.ts"),
      path.join(tmp.path, "sessions.sqlite"),
    ],
    {
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        XDG_STATE_HOME: path.join(tmp.path, "xdg-state"),
        XDG_DATA_HOME: path.join(tmp.path, "xdg-data"),
        XDG_CACHE_HOME: path.join(tmp.path, "xdg-cache"),
        XDG_CONFIG_HOME: path.join(tmp.path, "xdg-config"),
        REDCODE_TEST_HOME: path.join(tmp.path, "home"),
      },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    },
  )
  try {
    const deadline = Date.now() + 20_000
    while (!(await Bun.file(path.join(tmp.path, "wire.jsonl")).text()).includes("foreground delivery")) {
      if (server.exitCode !== null)
        throw new Error(`Foreground server exited: ${await new Response(server.stderr).text()}`)
      if (Date.now() > deadline) throw new Error("Foreground server did not deliver the pending result")
      await Bun.sleep(50)
    }
    const trace = await Bun.file(path.join(tmp.path, "wire.jsonl")).text()
    expect(trace.match(/foreground delivery/g)).toHaveLength(1)
    expect(trace.match(/"hold"/g)).toHaveLength(1)
  } finally {
    server.kill()
    await server.exited
  }
}, 30_000)

test("Codex reads every model page and identifies the running Redcode version", async () => {
  await using tmp = await tmpdir("redcode-codex-models-")
  const service = await createHarnesses(path.join(tmp.path, "state"), App.make({ name: "redcode", version: "9.8.7" }))
  try {
    const provider = await service.configure({ driver: "codex", executable: await executable(tmp.path, "codex") })
    expect(provider.models).toEqual([
      { id: "fixture-model", label: "Fixture model", recommended: true },
      { id: "fixture-second", label: "Second model", recommended: false },
    ])
    const captured = await Bun.file(path.join(tmp.path, "wire.jsonl")).text()
    expect(captured).toContain('"cursor":"models-second-page"')
    expect(captured).toContain('"clientInfo":{"name":"redcode","title":"Redcode","version":"9.8.7"}')
    expect(captured).not.toContain('"method":"turn/start"')
  } finally {
    await service.dispose()
  }
})

test("Codex reports a later model-page failure without presenting a partial catalog as complete", async () => {
  await using tmp = await tmpdir("redcode-codex-model-error-")
  const service = await createHarnesses(path.join(tmp.path, "state"))
  try {
    const provider = await service.configure({ driver: "codex", executable: await executable(tmp.path, "codex", true) })
    expect(provider.installed).toBe(true)
    expect(provider.authenticated).toBe(true)
    expect(provider.models).toBeUndefined()
    expect(provider.detail).toContain("The model catalog is temporarily unavailable")
  } finally {
    await service.dispose()
  }
})

for (const driver of ["codex", "claude"] as const) {
  test(`${driver}: structured permissions, questions, idempotent admission and native resume`, async () => {
    await using tmp = await tmpdir("redcode-harness-")
    const service = await createHarnesses(path.join(tmp.path, "state"))
    try {
      expect(await service.configure({ driver, executable: await executable(tmp.path, driver) })).toMatchObject({
        installed: true,
        authenticated: true,
      })
      const run = await service.open({ driver, directory: AbsolutePath.make(tmp.path) })
      await service.prompt(run.id, { id: "permission-input", text: "permission", delivery: "queue" })
      await until(() => service.read(run.id).requests.length === 1)
      const request = service.read(run.id).requests[0]
      expect(request.kind).toBe("permission")
      service.answer(run.id, { request: request.id, allow: true, answers: {} })
      await until(() => service.read(run.id).run.state === "ready")
      expect(service.read(run.id).events.some((event) => event.text === "fixture response")).toBe(true)
      const metrics = service.metrics()
      expect(JSON.stringify(metrics)).not.toContain("fixture response")
      expect(JSON.stringify(metrics)).not.toContain("echo fixture")
      const usage = metrics.find((item) => item.tokens !== null)!
      expect(usage).toMatchObject({
        source: driver,
        tokens: { input: 20, cache: { read: 80 } },
        sessionID: run.id,
        nativeSessionID: driver === "codex" ? "thread-fixture" : "claude-fixture",
      })
      expect(usage.scope).toBe(driver === "codex" ? "session" : "interaction")
      expect(metrics.filter((item) => item.tokens !== null)).toHaveLength(driver === "codex" ? 1 : 2)
      if (driver === "claude") {
        expect(usage.cost).toBeNull()
        expect(metrics.find((item) => item.scope === "session")).toMatchObject({
          cost: 0.002,
          pricingBasis: "estimated",
          coverage: "session_tree",
        })
      }
      service.acknowledgeMetric(usage.id)
      expect(service.metrics().some((item) => item.id === usage.id)).toBe(false)
      expect(() => service.answer(run.id, { request: request.id, allow: true, answers: {} })).toThrow(
        "no longer pending",
      )
      await service.prompt(run.id, { id: "question-input", text: "question", delivery: "queue" })
      await until(() => service.read(run.id).requests.length === 1)
      const question = service.read(run.id).requests[0]
      expect(question.kind).toBe("question")
      expect(() => service.answer(run.id, { request: question.id, allow: true, answers: {} })).toThrow("Answer every")
      service.answer(run.id, { request: question.id, allow: true, answers: { [question.questions[0].id]: "Small" } })
      await until(() => service.read(run.id).run.state === "ready")
      const before = await Bun.file(path.join(tmp.path, "wire.jsonl")).text()
      expect(before).not.toContain("redcode_background_wait")
      expect(before).not.toContain("redcode_delegate_task")
      if (driver === "claude") {
        expect(
          service
            .metrics()
            .filter((item) => item.scope === "session")
            .map((item) => item.cost),
        ).toEqual([0.002, 0.004])
        expect(
          service
            .metrics()
            .filter((item) => item.scope === "interaction")
            .every((item) => item.cost === null),
        ).toBe(true)
      }
      await service.prompt(run.id, { id: "permission-input", text: "different payload", delivery: "steer" })
      expect(await Bun.file(path.join(tmp.path, "wire.jsonl")).text()).toBe(before)
      const other = await service.open({ driver, directory: AbsolutePath.make(tmp.path) })
      await expect(
        service.prompt(other.id, { id: "permission-input", text: "permission", delivery: "queue" }),
      ).rejects.toThrow("another run")
      await service.close(other.id)
      expect(service.read(run.id).run.nativeID).toBe(driver === "codex" ? "thread-fixture" : "claude-fixture")
      await service.close(run.id)
      expect((await service.resume(run.id)).nativeID).toBe(driver === "codex" ? "thread-fixture" : "claude-fixture")
      await service.prompt(run.id, { id: "hold-input", text: "hold", delivery: "queue" })
      await service.prompt(run.id, { id: "queued-input", text: "later", delivery: "queue" })
      expect(service.list().runs.find((item) => item.id === run.id)?.queued).toBe(1)
      expect(service.read(run.id).run.queued).toBe(1)
      if (driver === "claude")
        await expect(service.prompt(run.id, { id: "steer-input", text: "now", delivery: "steer" })).rejects.toThrow(
          "does not support",
        )
      await service.interrupt(run.id)
      expect(service.list().runs.find((item) => item.id === run.id)?.queued).toBe(0)
      await service.close(run.id)
    } finally {
      await service.dispose()
    }
  }, 30_000)
}

for (const driver of ["codex", "claude"] as const) {
  test(`${driver}: explicit background waits stay bounded, owned and separate from task success`, async () => {
    await using tmp = await tmpdir("redcode-harness-wait-")
    const directory = path.join(tmp.path, "state")
    const service = await createHarnesses(directory)
    try {
      await service.configure({ driver, executable: await executable(tmp.path, driver) })
      const other = await service.open({ driver, directory: AbsolutePath.make(tmp.path) })
      await service.prompt(other.id, { id: "other-tasks", text: "native-tasks", delivery: "queue" })
      await until(() => service.read(other.id).run.state === "ready")
      await service.close(other.id)
      const run = await service.open({ driver, directory: AbsolutePath.make(tmp.path), backgroundWait: true })
      expect(run.backgroundWait).toBe(true)
      for (const mode of ["wait-success", "wait-timeout", "wait-foreign", "wait-invalid"]) {
        const before = service.read(run.id).events.length
        await service.prompt(run.id, { id: mode, text: mode, delivery: "queue" })
        await until(() => service.read(run.id).run.state === "ready")
        const result = service
          .read(run.id)
          .events.slice(before)
          .find((event) => event.text?.startsWith("WAIT_RESULT "))
        expect(result).toBeDefined()
        const text = result!.text!.slice("WAIT_RESULT ".length)
        if (mode === "wait-foreign" || mode === "wait-invalid") {
          expect(text).toContain(mode === "wait-foreign" ? "this harness run" : "Expected taskID")
          expect(service.read(run.id).tasks?.find((task) => task.title === mode)?.wait).toBeUndefined()
          continue
        }
        const output = Schema.decodeUnknownSync(
          Schema.fromJsonString(
            Schema.Struct({
              state: Schema.Literals(["settled", "timed_out"]),
              task: Harness.Task,
            }),
          ),
        )(text)
        expect(output.state).toBe(mode === "wait-success" ? "settled" : "timed_out")
        expect(output.task.status).toBe(mode === "wait-success" ? "failed" : "running")
        expect(output.task.wait?.state).toBe(output.state)
        expect(output.task.wait?.endedAt).toBeDefined()
      }
      const capture = await Bun.file(path.join(tmp.path, "wire.jsonl")).text()
      expect(capture).toContain("redcode_background_wait")
      expect(capture).toContain(driver === "codex" ? '"experimentalApi":true' : '"sdkMcpServers":["redcode_wait"]')
      expect(capture).toContain(driver === "codex" ? '"dynamicTools"' : '"readOnlyHint":true')
      if (driver === "codex") {
        await service.prompt(run.id, { id: "foreign-thread-wait", text: "wait-foreign-thread", delivery: "queue" })
        await until(() => service.read(run.id).run.state === "ready")
        expect(service.read(run.id).tasks?.find((task) => task.title === "wait-foreign-thread")?.wait).toBeUndefined()
      }
      await service.prompt(run.id, { id: "cancel-wait", text: "wait-cancel", delivery: "queue" })
      await until(() => service.read(run.id).tasks?.some((task) => task.wait?.state === "waiting") === true)
      await service.interrupt(run.id)
      expect(service.read(run.id).tasks?.find((task) => task.title === "wait-cancel")).toMatchObject({
        status: "running",
        wait: { state: "cancelled" },
      })
      expect(service.read(run.id).requests).toHaveLength(0)
      await service.close(run.id)
      await service.resume(run.id)
      await service.prompt(run.id, { id: "close-wait", text: "wait-close", delivery: "queue" })
      await until(() => service.read(run.id).tasks?.some((task) => task.wait?.state === "waiting") === true)
      await service.close(run.id)
      expect(service.read(run.id).tasks?.find((task) => task.title === "wait-close")?.wait?.state).toBe("cancelled")
      await service.resume(run.id)
      await service.prompt(run.id, { id: "shutdown-wait", text: "wait-shutdown", delivery: "queue" })
      await until(() => service.read(run.id).tasks?.some((task) => task.wait?.state === "waiting") === true)
      await service.dispose()
      const recovered = await createHarnesses(directory)
      try {
        expect(recovered.read(run.id).tasks?.find((task) => task.title === "wait-shutdown")).toMatchObject({
          status: "unknown",
          wait: { state: "unavailable" },
        })
      } finally {
        await recovered.dispose()
      }
    } finally {
      await service.dispose()
    }
  }, 30_000)
}

test("Codex rejects unsupported approvals and ignores foreign thread requests", async () => {
  await using tmp = await tmpdir("redcode-harness-boundary-")
  const service = await createHarnesses(path.join(tmp.path, "state"))
  try {
    await service.configure({ driver: "codex", executable: await executable(tmp.path, "codex") })
    const run = await service.open({ driver: "codex", directory: AbsolutePath.make(tmp.path) })
    await service.prompt(run.id, { id: "unsupported-input", text: "unsupported", delivery: "queue" })
    await until(() => service.read(run.id).requests.length === 1)
    const request = service.read(run.id).requests[0]
    expect(request.kind).toBe("unsupported")
    expect(() => service.answer(run.id, { request: request.id, allow: true, answers: {} })).toThrow(
      "cannot be approved",
    )
    service.answer(run.id, { request: request.id, allow: false, answers: {} })
    await until(() => service.read(run.id).run.state === "ready")
    await service.prompt(run.id, { id: "foreign-input", text: "foreign", delivery: "queue" })
    await until(() => service.read(run.id).run.state === "ready")
    expect(service.read(run.id).requests).toHaveLength(0)
    await service.close(run.id)
  } finally {
    await service.dispose()
  }
})

test("restart requires reconciliation and does not replay ambiguously admitted instructions", async () => {
  await using tmp = await tmpdir("redcode-harness-restart-")
  const directory = path.join(tmp.path, "state")
  const first = await createHarnesses(directory)
  await first.configure({ driver: "codex", executable: await executable(tmp.path, "codex") })
  const run = await first.open({ driver: "codex", directory: AbsolutePath.make(tmp.path) })
  await first.prompt(run.id, { id: "restart-input", text: "hold", delivery: "queue" })
  await first.dispose()
  const capture = await Bun.file(path.join(tmp.path, "wire.jsonl")).text()
  const recovered = await createHarnesses(directory)
  try {
    expect(recovered.read(run.id).run.state).toBe("unknown")
    await expect(recovered.resume(run.id)).rejects.toThrow("original process stopped")
    await expect(recovered.close(run.id)).rejects.toThrow("No owned process")
    recovered.reconcile(run.id)
    await recovered.resume(run.id)
    const after = await Bun.file(path.join(tmp.path, "wire.jsonl")).text()
    expect(after.slice(capture.length)).not.toContain("turn/start")
    await recovered.close(run.id)
  } finally {
    await recovered.dispose()
  }
})

test("provider sign-in keeps completion authoritative and passes Claude codes only to the live process", async () => {
  await using tmp = await tmpdir("redcode-harness-login-")
  const service = await createHarnesses(path.join(tmp.path, "state"))
  try {
    await service.configure({ driver: "codex", executable: await executable(tmp.path, "codex") })
    await service.configure({ driver: "claude", executable: await executable(tmp.path, "claude") })
    await service.login("codex")
    await until(() => service.loginStatus("codex").state === "complete")
    await service.login("claude")
    await until(() => !!service.loginStatus("claude").url)
    expect(service.loginStatus("claude").url).toBe("https://claude.example.test/authorize")
    service.loginAnswer("claude", "fixture-code")
    await until(() => service.loginStatus("claude").state === "complete")
    expect(() => service.loginAnswer("claude", "old-code")).toThrow("No pending")
    expect(service.list().runs).toHaveLength(0)
  } finally {
    await service.dispose()
  }
})

for (const driver of ["codex", "claude"] as const) {
  test(`${driver}: native task observations retain identity, classification and terminal state across restart`, async () => {
    await using tmp = await tmpdir("redcode-harness-tasks-")
    const directory = path.join(tmp.path, "state")
    const service = await createHarnesses(directory)
    const saved = { id: "" }
    try {
      await service.configure({ driver, executable: await executable(tmp.path, driver) })
      const run = await service.open({ driver, directory: AbsolutePath.make(tmp.path) })
      saved.id = run.id
      await service.prompt(run.id, { id: "task-observation", text: "native-tasks", delivery: "queue" })
      await until(() => service.read(run.id).tasks?.length === 3 && service.read(run.id).run.state === "ready")
      const tasks = service.read(run.id).tasks!
      expect(tasks.some((task) => task.id === "foreign-task")).toBe(false)
      expect(tasks.find((task) => task.id === "native-unknown")?.status).toBe("unknown")
      const finished = tasks.find((task) => task.id === (driver === "claude" ? "native-monitor" : "native-command"))!
      expect(finished.status).toBe("succeeded")
      expect(finished.output).toBe(driver === "claude" ? "deployment healthy" : "checks passed")
      expect(finished.kind).toBe(driver === "claude" ? "monitor" : "command")
      if (driver === "claude") {
        expect(finished).toMatchObject({
          parentTaskID: "native-parent",
          toolUseID: "monitor-call",
          outputFile: "/native/task-output.txt",
        })
        expect(tasks.find((task) => task.id === "native-active")?.kind).toBe("command")
        expect(tasks.find((task) => task.id === "native-unknown")?.kind).toBe("unknown")
      }
      if (driver === "codex") {
        expect(finished.processID).toBe("pty-42")
        expect(tasks.find((task) => task.id === "native-active")).toMatchObject({ truncated: true, status: "running" })
        expect(tasks.find((task) => task.id === "native-active")?.output).toEndWith("tail")
        expect(tasks.find((task) => task.id === "native-active")?.output.length).toBe(64000)
      }
      const other = await service.open({ driver, directory: AbsolutePath.make(tmp.path) })
      expect(service.read(other.id).tasks).toEqual([])
      await service.close(other.id)
    } finally {
      await service.dispose()
    }
    const recovered = await createHarnesses(directory)
    try {
      expect(recovered.read(saved.id).tasks?.find((task) => task.id === "native-active")?.status).toBe("unknown")
      expect(recovered.read(saved.id).tasks?.find((task) => task.status === "succeeded")?.output).toBe(
        driver === "claude" ? "deployment healthy" : "checks passed",
      )
      expect(recovered.read(saved.id).run.state).toBe("unknown")
    } finally {
      await recovered.dispose()
    }
  }, 30000)
}
