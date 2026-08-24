import { run as runTui, type TuiInput } from "@reddb-io/redcode-tui"
import { Global } from "@reddb-io/redcode-core/global"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}
