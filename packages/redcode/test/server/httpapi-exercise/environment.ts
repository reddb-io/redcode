import { Flag } from "@reddb-io/redcode-core/flag/flag"
import { Effect } from "effect"
import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "path"
import { removeOnExit, sharePlaywrightBrowsers } from "../../../../core/test/fixture/temp-root"

// Before HOME and the XDG variables are repointed below, or every run downloads its own Chromium.
sharePlaywrightBrowsers()

const preserveExerciseGlobalRoot = !!process.env.REDCODE_HTTPAPI_EXERCISE_GLOBAL
// Absolute before anything is registered against it: the process changes directory below.
export const exerciseGlobalRoot = path.resolve(
  process.env.REDCODE_HTTPAPI_EXERCISE_GLOBAL || path.join(os.tmpdir(), `opencode-httpapi-global-${process.pid}`),
)
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
// This runs before HOME is repointed, so git would otherwise read the developer's own config: a
// signing requirement fails the commit or waits on a pinentry, and a global hooks path runs their
// hooks. A repository with no commit still "works" — scenarios pass against a different kind of
// project — so a failure here stops the run instead of being ignored.
const gitHome = path.join(exerciseGlobalRoot, "git")
mkdirSync(path.join(gitHome, "hooks"), { recursive: true })
writeFileSync(path.join(gitHome, "config"), "")
const git = (...args: string[]) =>
  spawnSync(
    "git",
    [
      "-C",
      exerciseWorkingDirectory,
      "-c",
      "commit.gpgsign=false",
      "-c",
      `core.hooksPath=${path.join(gitHome, "hooks")}`,
      "-c",
      "init.defaultBranch=main",
      ...args,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: path.join(gitHome, "config"),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: "Exerciser",
        GIT_AUTHOR_EMAIL: "exerciser@example.test",
        GIT_COMMITTER_NAME: "Exerciser",
        GIT_COMMITTER_EMAIL: "exerciser@example.test",
      },
    },
  )
const mustGit = (...args: string[]) => {
  const result = git(...args)
  if (result.status !== 0)
    throw new Error(
      `git ${args.join(" ")} failed in ${exerciseWorkingDirectory}: ${result.stderr || result.stdout || result.error?.message || `exit ${result.status}`}`,
    )
}
if (git("rev-parse", "--verify", "--quiet", "HEAD").status !== 0) {
  mustGit("init", "--quiet")
  mustGit("commit", "--allow-empty", "--no-verify", "--quiet", "-m", "exerciser root")
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
// Scenarios publish Design revisions; none may launch the developer's browser.
process.env.REDCODE_DESIGN_NO_OPEN = "1"
export const exerciseConfigDirectory = path.join(exerciseGlobalRoot, "config", "opencode")
export const exerciseDataDirectory = path.join(exerciseGlobalRoot, ".red", "code", "data")

const preserveExerciseDatabase = !!process.env.REDCODE_HTTPAPI_EXERCISE_DB
export const exerciseDatabasePath = path.resolve(
  process.env.REDCODE_HTTPAPI_EXERCISE_DB || path.join(os.tmpdir(), `opencode-httpapi-exercise-${process.pid}.db`),
)
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
