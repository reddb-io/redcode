import { Flag } from "@reddb-io/redcode-core/flag/flag"
import { Effect } from "effect"
import { spawnSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import path from "path"
import { removeOnExit, sharePlaywrightBrowsers } from "../../../../core/test/fixture/temp-root"

// Before HOME and the XDG variables are repointed below, or every run downloads its own Chromium.
sharePlaywrightBrowsers()

const preserveExerciseGlobalRoot = !!process.env.REDCODE_HTTPAPI_EXERCISE_GLOBAL
export const exerciseGlobalRoot =
  process.env.REDCODE_HTTPAPI_EXERCISE_GLOBAL ??
  path.join(process.env.TMPDIR ?? "/tmp", `opencode-httpapi-global-${process.pid}`)
// The finalizer in index.ts only runs when the Effect program gets to finish; an interrupt or a
// crash before it used to leave the whole root behind.
if (!preserveExerciseGlobalRoot) removeOnExit(exerciseGlobalRoot)

// Scenarios marked `.global()` send no directory, and the server falls back to `process.cwd()` —
// which was the checkout the exerciser was launched from. Routes that act on "the current project"
// then ran against the developer's own repository: sessions and ptys opened in it, and worktrees
// created from it were registered in its `.git` while their files lived under the scratch root.
// A throwaway repository inside the root is what those scenarios act on instead.
export const exerciseWorkingDirectory = path.join(exerciseGlobalRoot, "cwd")
mkdirSync(exerciseWorkingDirectory, { recursive: true })
const git = (...args: string[]) =>
  spawnSync("git", ["-C", exerciseWorkingDirectory, ...args], { stdio: "ignore" }).status === 0
if (!git("rev-parse", "--verify", "HEAD")) {
  git("init", "--quiet")
  git(
    "-c",
    "user.name=Exerciser",
    "-c",
    "user.email=exerciser@example.test",
    "commit",
    "--allow-empty",
    "--quiet",
    "-m",
    "exerciser root",
  )
}
process.chdir(exerciseWorkingDirectory)
process.env.XDG_DATA_HOME = path.join(exerciseGlobalRoot, "data")
process.env.XDG_CONFIG_HOME = path.join(exerciseGlobalRoot, "config")
process.env.XDG_STATE_HOME = path.join(exerciseGlobalRoot, "state")
process.env.XDG_CACHE_HOME = path.join(exerciseGlobalRoot, "cache")
// Pin HOME and REDCODE_TEST_HOME so the new RedDB config home (`~/.red/code/`)
// resolves under the test scratch directory instead of the real user home. `REDCODE_TEST_HOME`
// wins in `@reddb-io/redcode-core/global` so it takes precedence here.
process.env.HOME = exerciseGlobalRoot
process.env.REDCODE_TEST_HOME = exerciseGlobalRoot
process.env.REDCODE_DISABLE_SHARE = "true"
export const exerciseConfigDirectory = path.join(exerciseGlobalRoot, "config", "opencode")
export const exerciseDataDirectory = path.join(exerciseGlobalRoot, ".red", "code", "data")

const preserveExerciseDatabase = !!process.env.REDCODE_HTTPAPI_EXERCISE_DB
export const exerciseDatabasePath =
  process.env.REDCODE_HTTPAPI_EXERCISE_DB ??
  path.join(process.env.TMPDIR ?? "/tmp", `opencode-httpapi-exercise-${process.pid}.db`)
process.env.REDCODE_DB = exerciseDatabasePath
if (!preserveExerciseDatabase)
  removeOnExit(exerciseDatabasePath, `${exerciseDatabasePath}-wal`, `${exerciseDatabasePath}-shm`)
Flag.REDCODE_DB = exerciseDatabasePath

export const original = {
  REDCODE_SERVER_PASSWORD: Flag.REDCODE_SERVER_PASSWORD,
  REDCODE_SERVER_USERNAME: Flag.REDCODE_SERVER_USERNAME,
}

export const cleanupExercisePaths = Effect.promise(async () => {
  const fs = await import("fs/promises")
  if (!preserveExerciseDatabase) {
    await Promise.all(
      [exerciseDatabasePath, `${exerciseDatabasePath}-wal`, `${exerciseDatabasePath}-shm`].map((file) =>
        fs.rm(file, { force: true }).catch(() => undefined),
      ),
    )
  }
  if (!preserveExerciseGlobalRoot)
    await fs.rm(exerciseGlobalRoot, { recursive: true, force: true }).catch(() => undefined)
})
