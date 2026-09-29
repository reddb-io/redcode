const prefix = "REDCODE_"

// Redcode documents REDCODE_* names for the OPENCODE_* variables the code reads.
// Mirror every REDCODE_X onto OPENCODE_X so both spellings work everywhere, with
// the Redcode name winning when both are set. Entrypoints import this module
// before anything else because many modules read the environment while loading.
export function apply(env: Record<string, string | undefined>) {
  Object.entries(env)
    .filter((entry): entry is [string, string] => entry[0].startsWith(prefix) && entry[1] !== undefined)
    .forEach((entry) => {
      env[`OPENCODE_${entry[0].slice(prefix.length)}`] = entry[1]
    })
}

apply(process.env)

export * as EnvAlias from "./env-alias.js"
