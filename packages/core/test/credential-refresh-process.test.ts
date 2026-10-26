import { expect, test } from "bun:test"
import { tmpdir } from "./fixture/tmpdir"

test("two processes sharing credentials rotate an expiring token only once", async () => {
  await using directory = await tmpdir("oauth-refresh-")
  const entered = Promise.withResolvers<void>()
  const ready = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let calls = 0
  let waiters = 0
  using server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      if (new URL(request.url).pathname === "/ready") {
        if (++waiters === 2) ready.resolve()
        return new Response("ready")
      }
      expect(await request.text()).toBe("old")
      calls++
      entered.resolve()
      await release.promise
      return new Response(calls === 1 ? "rotated" : "token reuse", { status: calls === 1 ? 200 : 409 })
    },
  })
  const spawn = (mode: string) =>
    Bun.spawn(
      [process.execPath, `${import.meta.dir}/fixture/oauth-refresh.ts`, mode, directory.path, server.url.href],
      {
        env: { ...process.env, OPENCODE_DB: undefined },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
  const finish = async (child: ReturnType<typeof spawn>) => {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(stderr).toBe("")
    expect(code).toBe(0)
    return stdout.trim()
  }
  await finish(spawn("seed"))
  const first = spawn("resolve")
  await entered.promise
  const second = spawn("resolve")
  try {
    await ready.promise
    // Keep the first rotation in flight while the other process reaches its database read and file lock.
    await Bun.sleep(100)
    expect(calls).toBe(1)
  } finally {
    release.resolve()
  }
  expect(await finish(first)).toContain('"access":"new"')
  expect(await finish(second)).toContain('"access":"new"')
  expect(calls).toBe(1)
}, 15_000)
