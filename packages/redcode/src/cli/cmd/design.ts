import { cmd } from "./cmd"

export const DesignCommand = cmd({
  command: "design [prompt..]",
  describe: "open a Design session in the terminal with browser review",
  builder: (yargs) =>
    yargs
      .positional("prompt", { type: "string", array: true, describe: "initial message" })
      .option("session", { alias: "s", type: "string", describe: "adopt an existing V2 session without resuming it" })
      .option("agent", { choices: ["design", "plan", "build"] as const, describe: "mode for a new session" })
      .option("model", { type: "string", describe: "provider/model for a new session" })
      .option("directory", { type: "string", describe: "project directory for a new session" })
      .option("attach", { type: "string", describe: "connect to an existing Redcode server" })
      .option("open", { type: "boolean", default: false, describe: "open browser review on startup" }),
  async handler(args) {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      throw new Error("The Design terminal requires an interactive terminal. Use redcode run for noninteractive work.")
    const { run } = await import("../design-command")
    await run(args)
  },
})
