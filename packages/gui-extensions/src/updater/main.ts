import { spawn } from "node:child_process"
import { closeSync, mkdirSync, openSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { Schema } from "effect"
import { MenubarItem, type Log, type MainSetup } from "../sdk/main"
import { Updater } from "./contract"
import type definition from "./index"
import { RELEASES_URL } from "./release"

const setup: MainSetup<typeof definition> = (ctx) => {
  const binary = ctx.cli.installed ? ctx.cli.binary : undefined
  let pending: Promise<string | null> | undefined

  const releases = () => {
    const cached = ctx.stores.releaseCache.value
    if (cached.until > Date.now()) return Promise.resolve(cached.data ?? null)
    if (pending) return pending
    pending = fetch(RELEASES_URL, {
      signal: AbortSignal.any([ctx.scope.signal, AbortSignal.timeout(30_000)]),
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (ctx.scope.signal.aborted) return null
        if (!response.ok) {
          const retry = response.headers.get("retry-after")
          const seconds = retry === null ? NaN : Number(retry)
          const retryAt =
            retry === null ? NaN : Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(retry)
          const reset = response.headers.get("x-ratelimit-reset")
          const resetAt =
            response.headers.get("x-ratelimit-remaining") === "0" && reset !== null ? Number(reset) * 1000 : NaN
          ctx.stores.releaseCache.set({
            until: Math.max(
              Date.now() + 5 * 60_000,
              Number.isFinite(retryAt) ? retryAt : 0,
              Number.isFinite(resetAt) ? resetAt : 0,
            ),
          })
          await response.body?.cancel()
          return null
        }
        const data = await response.text()
        Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(data)
        if (ctx.scope.signal.aborted) return null
        ctx.stores.releaseCache.set({ until: Date.now() + 5 * 60_000, data })
        return data
      })
      .catch(() => {
        if (!ctx.scope.signal.aborted) ctx.stores.releaseCache.set({ until: Date.now() + 5 * 60_000 })
        return null
      })
      .finally(() => {
        pending = undefined
      })
    return pending
  }

  const provider = ctx.provide(Updater, {
    state: () => ({ upgradable: binary !== undefined }),
    releases,
    upgrade: async () => {
      if (!binary) throw new Error("This app does not run the CLI of a Redcode installation")

      // The other extensions are disposed first; the upgrade starts only once the app is quitting.
      await ctx.lifecycle.restart(async () => {
        await upgrade(binary, ctx.log)
        const { app } = await import("electron")
        app.quit()
      })
    },
  })

  ctx.add(
    MenubarItem,
    (): MenubarItem => ({
      menu: "app",
      id: "check",
      label: ctx.t("menu.check"),
      after: "about",
      // The focused window checks, so the answer shows where the user asked.
      run(window) {
        if (window) provider.emit("check", null, window.id)
      },
    }),
  )
}

/**
 * Starts `redcode upgrade` detached, so it outlives the app it replaces. Its output goes to the desktop log directory,
 * since no window is left to show it. Resolves once the process started.
 */
async function upgrade(binary: string, log: Log) {
  const { app } = await import("electron")
  const directory = path.join(app.getPath("userData"), "logs")
  const file = path.join(directory, "redcode-upgrade.log")
  mkdirSync(directory, { recursive: true })
  const output = openSync(file, "w")
  // The home directory, not the app's: Windows cannot replace a folder that is a process's working directory.
  const child = spawn(binary, ["upgrade"], {
    cwd: homedir(),
    detached: true,
    stdio: ["ignore", output, output],
    windowsHide: true,
  })

  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve)
    child.once("error", reject)
  }).finally(() => closeSync(output))
  child.unref()
  log.write("info", "redcode upgrade started", { binary, log: file, pid: child.pid })
}

export default setup
