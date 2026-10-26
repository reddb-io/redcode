import { Credential } from "@opencode/core/credential"
import { Database } from "@opencode/core/database/database"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect } from "effect"

const [mode, directory, endpoint] = process.argv.slice(2)
if (!directory || !endpoint || !["seed", "resolve"].includes(mode)) throw new Error("Expected fixture arguments")
const integrationID = Integration.ID.make("fixture")
const methodID = Integration.MethodID.make("oauth")
const id = Credential.ID.make("cred_cross_process")

const result = await Effect.runPromise(
  Effect.gen(function* () {
    const credentials = yield* Credential.Service
    if (mode === "seed") {
      yield* credentials.create({
        id,
        integrationID,
        value: Credential.OAuth.make({ type: "oauth", methodID, access: "old", refresh: "old", expires: 1 }),
      })
      return "seeded"
    }
    const integration = yield* Integration.Service
    yield* integration.transform((editor) =>
      editor.method.update({
        integrationID,
        method: { id: methodID, type: "oauth", label: "Fixture" },
        authorize: () => Effect.die("unused sign-in"),
        refresh: (value) =>
          Effect.promise(async () => {
            const response = await fetch(`${endpoint}/refresh`, { method: "POST", body: value.refresh })
            if (!response.ok) throw new Error("Refresh token already rotated")
            return Credential.OAuth.make({ ...value, access: "new", refresh: "new", expires: 1e15 })
          }),
      }),
    )
    yield* Effect.promise(() => fetch(`${endpoint}/ready`))
    return yield* integration.connection.resolve({ type: "credential", id, label: "Fixture", method: "oauth" })
  }).pipe(
    Effect.scoped,
    Effect.provide(
      LayerNode.compile(LayerNode.group([Credential.node, Integration.node]), {
        replacements: [
          Database.node.replace(Database.configured({ path: `${directory}/credentials.db` })),
          Global.node.replace(Global.layerWith({ state: `${directory}/state` })),
          Location.node.replace(Location.boundNode({ directory: AbsolutePath.make(process.cwd()) })),
        ],
      }),
    ),
  ),
)
console.log(JSON.stringify(result))
