import { EOL } from "os"
import { BootTrace } from "@reddb-io/redcode-core/observability/boot-trace"
import { cmd } from "../cmd"

// The same marks `--verbose` prints, from the same tracer: this command boots nothing of its
// own, so what it shows is the cost of reaching a command handler — module graph, home
// directory, argv — which is the floor under every other command's boot.
export const StartupCommand = cmd({
  command: "startup",
  describe: "print startup timing",
  builder: (yargs) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "print the recorded boot phases as JSON",
    }),
  handler(args) {
    const marks = [...BootTrace.phases(), BootTrace.mark("debug.startup")]
    if (args.json) {
      process.stdout.write(JSON.stringify({ total: marks.at(-1)?.since ?? 0, phases: marks }, null, 2) + EOL)
      return
    }
    // Under --verbose the tracer already printed every mark to stderr as it happened.
    if (!BootTrace.enabled()) for (const mark of marks) process.stdout.write(BootTrace.formatMark(mark) + EOL)
    process.stdout.write(`total ${Math.round(marks.at(-1)?.since ?? 0)}ms` + EOL)
  },
})
