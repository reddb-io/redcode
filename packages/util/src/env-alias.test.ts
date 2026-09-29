import { expect, test } from "bun:test"
import { EnvAlias } from "./env-alias.js"

test("REDCODE_* variables alias their OPENCODE_* names and win over them", () => {
  const env: Record<string, string | undefined> = {
    REDCODE_CONFIG: "/redcode.jsonc",
    OPENCODE_CONFIG: "/opencode.jsonc",
    REDCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DB: "opencode.db",
    REDCODE_UNSET: undefined,
    PATH: "/usr/bin",
  }
  EnvAlias.apply(env)
  expect(env).toEqual({
    REDCODE_CONFIG: "/redcode.jsonc",
    OPENCODE_CONFIG: "/redcode.jsonc",
    REDCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DB: "opencode.db",
    REDCODE_UNSET: undefined,
    PATH: "/usr/bin",
  })
})
