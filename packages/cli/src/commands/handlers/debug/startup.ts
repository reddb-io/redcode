import { EOL } from "node:os"
import { Effect } from "effect"
import { BootTrace } from "../../../boot-trace"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

// The marks `--verbose` prints, from the same recorder. This command boots nothing of its own, so
// what it shows is the cost of reaching a command handler (module graph, config, logging), which is
// the floor under every other command's boot.
export default Runtime.handler(
  Commands.commands.debug.commands.startup,
  Effect.fn("cli.debug.startup")(function* (input) {
    const marks = [...BootTrace.phases(), BootTrace.mark("debug.startup")]
    const total = Math.round(marks.at(-1)?.since ?? 0)
    if (input.json) {
      process.stdout.write(JSON.stringify({ total, phases: marks }, null, 2) + EOL)
      return
    }
    // Under --verbose every mark already went to stderr as it happened.
    if (!BootTrace.enabled()) marks.forEach((mark) => process.stdout.write(BootTrace.format(mark) + EOL))
    process.stdout.write(`total ${total}ms${EOL}`)
  }),
)
