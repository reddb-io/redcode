import { expect, test } from "bun:test"
import { writeFile, chmod } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { createHarnesses } from "../src/harness"
import { Harness } from "@opencode/schema/harness"
import { AbsolutePath } from "@opencode/schema/schema"

const fixture = path.resolve(import.meta.dir, "fixture/harness-process.ts")
async function executable(root: string, driver: Harness.Driver) {
  const file = path.join(root, driver + (process.platform === "win32" ? ".cmd" : ".sh"))
  await writeFile(
    file,
    process.platform === "win32"
      ? `@"${process.execPath}" "${fixture}" ${driver} "${path.join(root, "wire.jsonl")}" %*\r\n`
      : `#!/bin/sh\nexec '${process.execPath}' '${fixture}' ${driver} '${path.join(root, "wire.jsonl")}' "$@"\n`,
  )
  await chmod(file, 0o700)
  return file
}
async function until(check: () => boolean) {
  const end = Date.now() + 5000
  while (!check()) {
    if (Date.now() > end) throw new Error("Protocol did not settle")
    await Bun.sleep(10)
  }
}

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
