import { SetupCommand } from "./cli/cmd/setup"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { RunCommand } from "./cli/cmd/run"
import { DesignCommand } from "./cli/cmd/design"
import { GenerateCommand } from "./cli/cmd/generate"
import { ConsoleCommand } from "./cli/cmd/account"
import { ProvidersCommand } from "./cli/cmd/providers"
import { AgentCommand } from "./cli/cmd/agent"
import { UpgradeCommand } from "./cli/cmd/upgrade"
import { UninstallCommand } from "./cli/cmd/uninstall"
import { ModelsCommand } from "./cli/cmd/models"
import { UI } from "./cli/ui"
import { InstallationVersion } from "@reddb-io/redcode-core/installation/version"
import { FormatError } from "./cli/error"
import { ServeCommand } from "./cli/cmd/serve"
import { DebugCommand } from "./cli/cmd/debug"
import { StatsCommand } from "./cli/cmd/stats"
import { McpCommand } from "./cli/cmd/mcp"
import { GithubCommand } from "./cli/cmd/github"
import { ExportCommand } from "./cli/cmd/export"
import { ImportCommand } from "./cli/cmd/import"
import { AttachCommand } from "./cli/cmd/attach"
import { TuiThreadCommand } from "./cli/cmd/tui"
import { AcpCommand } from "./cli/cmd/acp"
import { EOL } from "os"
import { WebCommand } from "./cli/cmd/web"
import { PrCommand } from "./cli/cmd/pr"
import { SessionCommand } from "./cli/cmd/session"
import { DbCommand } from "./cli/cmd/db"
import { WorktreesCommand } from "./cli/cmd/worktrees"
import { UsageCommand } from "./cli/cmd/usage"
import { Shutdown } from "./effect/shutdown"
import { errorMessage } from "./util/error"
import { PluginCommand } from "./cli/cmd/plug"
import { Heap } from "./cli/heap"
import { Global } from "@reddb-io/redcode-core/global"
import { BootTrace } from "@reddb-io/redcode-core/observability/boot-trace"

// Recorded before argv is parsed: `process.start` is the module graph above — imports resolved,
// the home directory made — measured from the process's own start.
// Argument values stay out of the trace: `attach --password` is one of them.
BootTrace.mark("process.start", { args: hideBin(process.argv).length })

const args = hideBin(process.argv)

function show(out: string) {
  const text = out.trimStart()
  if (!text.startsWith("redcode ")) {
    process.stderr.write(UI.logo() + EOL + EOL)
    process.stderr.write(text + EOL)
    return
  }
  process.stderr.write(out)
}

const cli = yargs(args)
  .parserConfiguration({ "populate--": true })
  .scriptName("redcode")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", InstallationVersion)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .option("pure", {
    describe: "run without external plugins",
    type: "boolean",
  })
  .option("reasoning", {
    describe: "reasoning mode for this run",
    type: "string",
    choices: ["single", "dual"],
  })
  .option("verbose", {
    describe: "trace the boot to stderr until the screen renders, then trace activity to the log",
    type: "boolean",
  })
  .middleware(async (opts) => {
    if (opts.printLogs) process.env.REDCODE_PRINT_LOGS = "1"
    if (opts.logLevel) process.env.REDCODE_LOG_LEVEL = opts.logLevel
    if (opts.pure) {
      process.env.REDCODE_PURE = "1"
    }
    // Overrides the saved setting for this run; the TUI worker and server inherit the environment.
    if (opts.reasoning) process.env.REDCODE_REASONING = opts.reasoning
    // Kept in the tracer, not in the environment: a nested redcode the bash tool spawns must not
    // inherit the flag. The file log's level follows it (see Logging.minimumLogLevel).
    if (opts.verbose) BootTrace.enable()
    BootTrace.mark("cli.parsed", {
      version: InstallationVersion,
      command: String(opts._[0] ?? "tui"),
      pid: process.pid,
      cwd: process.cwd(),
      data: Global.Path.data,
      state: Global.Path.state,
      config: Global.Path.config,
      log: Global.Path.log,
    })

    Heap.start()

    process.env.AGENT = "1"
    process.env.OPENCODE = "1"
    process.env.REDCODE_PID = String(process.pid)
  })
  .usage("")
  .completion("completion", "generate shell completion script")
  .command(AcpCommand)
  .command(McpCommand)
  .command(TuiThreadCommand)
  .command(AttachCommand)
  .command(RunCommand)
  .command(DesignCommand)
  .command(GenerateCommand)
  .command(DebugCommand)
  .command(ConsoleCommand)
  .command(ProvidersCommand)
  .command(AgentCommand)
  .command(UpgradeCommand)
  .command(UninstallCommand)
  .command(ServeCommand)
  .command(WebCommand)
  .command(ModelsCommand)
  .command(SetupCommand)
  .command(StatsCommand)
  .command(ExportCommand)
  .command(ImportCommand)
  .command(GithubCommand)
  .command(PrCommand)
  .command(SessionCommand)
  .command(PluginCommand)
  .command(DbCommand)
  .command(WorktreesCommand)
  .command(UsageCommand)
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp(show)
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

try {
  if (args.includes("-h") || args.includes("--help")) {
    await cli.parse(args, (err: Error | undefined, _argv: unknown, out: string) => {
      if (err) throw err
      if (!out) return
      show(out)
    })
  } else {
    await cli.parse()
  }
} catch (e) {
  const { Logging } = await import("@reddb-io/redcode-core/observability/logging")
  await Logging.fatal(e)
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error" + EOL)
    process.stderr.write(errorMessage(e) + EOL)
  }
  process.exitCode = 1
} finally {
  // Close what the runtime opened, the database above all, but only wait so long for it.
  await Shutdown.run()
  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  process.exit()
}
