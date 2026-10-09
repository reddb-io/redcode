import { spawn } from "node:child_process"
import { closeSync, mkdirSync, openSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { app } from "electron"
import { MenubarItem, type Log, type MainSetup } from "../sdk/main"
import { Updater } from "./contract"
import type definition from "./index"

const setup: MainSetup<typeof definition> = (ctx) => {
  const binary = ctx.cli.installed ? ctx.cli.binary : undefined

  const provider = ctx.provide(Updater, {
    state: () => ({ upgradable: binary !== undefined }),
    upgrade: async () => {
      if (!binary) throw new Error("This app does not run the CLI of a Redcode installation")

      // The other extensions are disposed first; the upgrade starts only once the app is quitting.
      await ctx.lifecycle.restart(async () => {
        await upgrade(binary, ctx.log)
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
