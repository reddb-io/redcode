import { execFileSync } from "node:child_process"
import { userInfo } from "node:os"

const SEPARATOR = "__REDCODE_ENV__"

/**
 * Apps launched from a desktop environment do not inherit the login shell's environment, so tools the
 * service spawns (git, language servers, version managers) would not be found. Read it once at startup.
 */
export function loadShellEnv() {
  if (process.platform === "win32") return
  const shell = process.env.SHELL ?? userInfo().shell ?? "/bin/sh"
  const output = (() => {
    try {
      return execFileSync(shell, ["-ilc", `printf '${SEPARATOR}'; env -0; printf '${SEPARATOR}'`], {
        encoding: "utf8",
        timeout: 5_000,
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, TERM: "dumb" },
      })
    } catch {
      return
    }
  })()
  const body = output?.split(SEPARATOR)[1]
  if (!body) return
  Object.assign(
    process.env,
    Object.fromEntries(
      body
        .split("\0")
        .filter(Boolean)
        .flatMap((entry) => {
          const index = entry.indexOf("=")
          return index > 0 ? [[entry.slice(0, index), entry.slice(index + 1)] as const] : []
        }),
    ),
  )
}
