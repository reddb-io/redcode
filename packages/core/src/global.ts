import path from "path"
import fs from "fs/promises"
import { xdgData, xdgCache, xdgState } from "xdg-basedir"
import os from "os"
import { Context, Effect, Layer } from "effect"
import { Flock } from "./util/flock"
import { Flag } from "./flag/flag"
import { makeGlobalNode } from "./effect/app-node"

const app = "redcode"
const home = process.env.REDCODE_TEST_HOME ?? os.homedir()

// Primary paths live under the RedDB family alongside redskilled
// (`~/.red/redskilled`), so `redcode` joins it instead of splitting across XDG.
const redcodeHome = path.join(home, ".red", app)
const data = path.join(redcodeHome, "data")
const cache = path.join(redcodeHome, "cache")
const config = redcodeHome
const state = path.join(redcodeHome, "state")
const tmp = path.join(os.tmpdir(), app)

const paths = {
  get home() {
    return process.env.REDCODE_TEST_HOME ?? os.homedir()
  },
  data,
  bin: path.join(cache, "bin"),
  log: path.join(data, "log"),
  repos: path.join(data, "repos"),
  cache,
  config,
  state,
  tmp,
}

export const Path = paths

Flock.setGlobal({ state })

// This is module-level, so it runs before argv is even parsed — `redcode --version`
// included. When the home directory sits on a stalled mount (a dropped network drive, a
// Windows filesystem seen through WSL) these calls block with nothing printed and no way
// to tell what is wrong. Say what is stuck and let the process continue: whatever needs a
// directory will fail with its own error, which is far easier to act on than a freeze.
const MKDIR_DEADLINE_MS = 10_000

await Promise.race([
  Promise.all([
    fs.mkdir(Path.data, { recursive: true }),
    fs.mkdir(Path.config, { recursive: true }),
    fs.mkdir(Path.state, { recursive: true }),
    fs.mkdir(Path.tmp, { recursive: true }),
    fs.mkdir(Path.log, { recursive: true }),
    fs.mkdir(Path.bin, { recursive: true }),
    fs.mkdir(Path.repos, { recursive: true }),
  ]),
  new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      process.stderr.write(
        `redcode: still waiting on ${redcodeHome} after ${MKDIR_DEADLINE_MS / 1000}s — ` +
          `the filesystem holding it may be unavailable. Set REDCODE_TEST_HOME or HOME to a local path.\n`,
      )
      resolve()
    }, MKDIR_DEADLINE_MS)
    timer.unref?.()
  }),
])

export class Service extends Context.Service<Service, Interface>()("@redcode/Global") {}

export interface Interface {
  readonly home: string
  readonly data: string
  readonly cache: string
  readonly config: string
  readonly state: string
  readonly tmp: string
  readonly bin: string
  readonly log: string
  readonly repos: string
}

export function make(input: Partial<Interface> = {}): Interface {
  return {
    home: Path.home,
    data: Path.data,
    cache: Path.cache,
    config: Flag.REDCODE_CONFIG_DIR ?? Path.config,
    state: Path.state,
    tmp: Path.tmp,
    bin: Path.bin,
    log: Path.log,
    repos: Path.repos,
    ...input,
  }
}

const layer = Layer.effect(
  Service,
  Effect.sync(() => Service.of(make())),
)

export const node = makeGlobalNode({ service: Service, layer: layer, deps: [] })

export const layerWith = (input: Partial<Interface>) =>
  Layer.effect(
    Service,
    Effect.sync(() => Service.of(make(input))),
  )

export * as Global from "./global"
