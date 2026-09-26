import { Effect, Layer } from "effect"
import { EOL } from "node:os"
import { existsSync, realpathSync } from "node:fs"
import path from "node:path"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { select } from "../../../database-selection"

export default Runtime.handler(
  Commands.commands.session.commands["import-redcode"],
  Effect.fn("cli.session.import-redcode")(function* (input) {
    if (!process.versions.bun) return yield* Effect.fail(new Error("Redcode SQLite import requires Bun"))
    const source = path.resolve(input.file)
    if (!existsSync(source)) return yield* Effect.fail(new Error(`Redcode database does not exist: ${source}`))
    const global = yield* Global.Service
    const target = yield* Effect.promise(() => select(global))
    if (target.path === ":memory:")
      return yield* Effect.fail(new Error("Redcode import requires a persistent target database"))
    if (target.path && existsSync(target.path) && realpathSync(source) === realpathSync(target.path))
      return yield* Effect.fail(new Error("Source and target databases must be different files"))
    const { Database } = yield* Effect.promise(() => import("@opencode/core/database/database"))
    const { V1Migration } = yield* Effect.promise(() => import("@opencode/core/database/v1-migration"))
    const result = yield* V1Migration.importRedcode(source).pipe(Effect.provide(Database.layer(target)))
    const { Bus } = yield* Effect.promise(() => import("@opencode/core/bus"))
    const { SessionProjector } = yield* Effect.promise(() => import("@opencode/core/session/projector"))
    const { RedcodePending } = yield* Effect.promise(() => import("@opencode/core/session/redcode-pending"))
    const pending = yield* RedcodePending.admit().pipe(
      Effect.provide(
        LayerNode.compile(LayerNode.group([Global.node, Database.node, Bus.node, SessionProjector.node]), {
          replacements: [
            Global.node.replace(Layer.succeed(Global.Service, global)),
            Database.node.replace(Database.configured(target)),
          ],
        }),
      ),
    )
    process.stdout.write(
      `Imported ${result.imported} sessions; skipped ${result.skipped} existing sessions; processed ${pending} pending inputs${EOL}`,
    )
  }),
)
