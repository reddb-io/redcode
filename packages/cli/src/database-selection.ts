import path from "node:path"
import { readFile } from "node:fs/promises"
import { Option, Schema } from "effect"
import type { Global } from "@opencode/util/global"
import { Database } from "@opencode/core/database/database"
import { ConfigDatabase } from "@opencode/schema/config/database"
import { databasePath } from "./database-path"

export async function select(global: Global.Interface): Promise<Database.Options> {
  const url = process.env.REDCODE_DATABASE_URL?.trim() || (await configuredURL(global.config, global.home))
  if (url) return { url: Database.validateURL(url), token: process.env.REDCODE_DATABASE_TOKEN }
  return { path: databasePath(global.data) }
}

async function configuredURL(directory: string, home: string) {
  const { parse } = await import("jsonc-parser")
  const decode = Schema.decodeUnknownOption(ConfigDatabase.Info)
  const files = await Promise.all(
    [path.join(home, ".red", "redcode"), path.join(home, ".red", "code"), directory]
      .flatMap((root) =>
        ["opencode.json", "opencode.jsonc", "redcode.json", "redcode.jsonc", "config.json", "config.jsonc"].map(
          (name) => path.join(root, name),
        ),
      )
      .map(async (file) => {
        const content = await readFile(file, "utf8").catch(() => undefined)
        if (!content) return
        const value: unknown = parse(content)
        if (typeof value !== "object" || value === null || !("database" in value)) return
        return Option.getOrUndefined(decode(value.database))?.url
      }),
  )
  return files.findLast((url) => url !== undefined)
}
