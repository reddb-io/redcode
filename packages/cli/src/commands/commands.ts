import { Argument, Flag, GlobalFlag } from "effect/unstable/cli"
import { Schema } from "effect"
import { Spec } from "../framework/spec"
import { Updater } from "../services/updater"

export const PrintLogs = GlobalFlag.setting("print-logs")({
  flag: Flag.boolean("print-logs").pipe(
    Flag.withDescription("Print logs to stderr (server logs require --standalone)"),
    Flag.withDefault(false),
  ),
})

declare const OPENCODE_CLI_NAME: string | undefined

const ServerParams = {
  standalone: Flag.boolean("standalone").pipe(
    Flag.withDescription("Run with a private server instead of the background service"),
    Flag.withDefault(false),
  ),
  server: Flag.string("server").pipe(
    Flag.withDescription("Connect to a server URL instead of the background service"),
    Flag.optional,
  ),
}

const PermissionParams = {
  auto: Flag.boolean("auto").pipe(
    Flag.withDescription("Auto-approve permissions that are not explicitly denied"),
    Flag.withDefault(false),
  ),
  yolo: Flag.boolean("yolo").pipe(Flag.withDefault(false), Flag.withHidden),
  dangerouslySkipPermissions: Flag.boolean("dangerously-skip-permissions").pipe(
    Flag.withDefault(false),
    Flag.withHidden,
  ),
}

const Root = Spec.make(typeof OPENCODE_CLI_NAME === "string" ? OPENCODE_CLI_NAME : "opencode", {
  description: "OpenCode command line interface",
  params: {
    ...ServerParams,
    ...PermissionParams,
    directory: Argument.string("directory").pipe(
      Argument.withDescription("Directory to start OpenCode in"),
      Argument.optional,
    ),
    continue: Flag.boolean("continue").pipe(
      Flag.withAlias("c"),
      Flag.withDescription("Continue the last session"),
      Flag.withDefault(false),
    ),
    session: Flag.string("session").pipe(
      Flag.withAlias("s"),
      Flag.withDescription("Session ID to continue"),
      Flag.optional,
    ),
    prompt: Flag.string("prompt").pipe(Flag.withDescription("Prompt to use"), Flag.optional),
  },
  commands: [
    Spec.make("upgrade", {
      description: "Upgrade OpenCode to the latest or a specific version",
      aliases: ["update"],
      params: {
        target: Argument.string("target").pipe(
          Argument.withDescription("Version to upgrade to (with or without a leading v)"),
          Argument.optional,
        ),
        method: Flag.choice("method", Updater.methods).pipe(
          Flag.withAlias("m"),
          Flag.withDescription("Installation method to use"),
          Flag.optional,
        ),
      },
    }),
    Spec.make("uninstall", {
      description: "Uninstall OpenCode and remove all related files",
      params: {
        keepConfig: Flag.boolean("keep-config").pipe(
          Flag.withAlias("c"),
          Flag.withDescription("Keep configuration files"),
          Flag.withDefault(false),
        ),
        keepData: Flag.boolean("keep-data").pipe(
          Flag.withAlias("d"),
          Flag.withDescription("Keep session data and snapshots"),
          Flag.withDefault(false),
        ),
        dryRun: Flag.boolean("dry-run").pipe(
          Flag.withDescription("Show what would be removed without removing"),
          Flag.withDefault(false),
        ),
        force: Flag.boolean("force").pipe(
          Flag.withAlias("f"),
          Flag.withDescription("Skip confirmation prompts"),
          Flag.withDefault(false),
        ),
      },
    }),
    Spec.make("acp", { description: "Start an Agent Client Protocol server" }),
    Spec.make("api", {
      description: "Make a request to the running server",
      params: {
        ...ServerParams,
        request: Argument.string("operation | method path").pipe(
          Argument.withDescription("OpenAPI operation ID, or an HTTP method followed by a path"),
          Argument.variadic({ min: 1, max: 2 }),
        ),
        data: Flag.string("data").pipe(Flag.withAlias("d"), Flag.withDescription("Request body"), Flag.optional),
        header: Flag.string("header").pipe(
          Flag.withAlias("H"),
          Flag.withDescription("Request header in name:value form"),
          Flag.atMost(100),
        ),
        param: Flag.keyValuePair("param").pipe(Flag.withDescription("OpenAPI path or query parameter"), Flag.optional),
      },
    }),
    Spec.make("debug", {
      description: "Debugging and troubleshooting tools",
      commands: [
        Spec.make("agents", { description: "List all agents" }),
        Spec.make("config", { description: "List configuration sources" }),
        Spec.make("lsp", {
          description: "Inspect language servers",
          commands: [
            Spec.make("status", { description: "List language server status" }),
            Spec.make("diagnostics", {
              description: "Get diagnostics for a file",
              params: { file: Argument.string("file") },
            }),
            Spec.make("symbols", {
              description: "Search workspace symbols",
              params: { query: Argument.string("query") },
            }),
            Spec.make("document-symbols", {
              description: "Get symbols from a file",
              params: { file: Argument.string("file") },
            }),
          ],
        }),
        Spec.make("formatter", { description: "List formatter status" }),
        Spec.make("file", {
          description: "File system debugging utilities",
          commands: [
            Spec.make("read", {
              description: "Read file contents as JSON",
              params: { path: Argument.string("path") },
            }),
            Spec.make("list", {
              description: "List files in a directory",
              params: { path: Argument.string("path") },
            }),
            Spec.make("search", {
              description: "Search files by query",
              params: { query: Argument.string("query") },
            }),
          ],
        }),
        Spec.make("skill", { description: "List all available skills" }),
        Spec.make("limits", {
          description: "Inspect input limits learned from providers",
          params: {
            json: Flag.boolean("json").pipe(Flag.withDefault(false)),
            forget: Flag.string("forget").pipe(Flag.optional),
          },
        }),
        Spec.make("guards", {
          description: "Inspect session guard interventions",
          params: {
            days: Flag.integer("days").pipe(
              Flag.withSchema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
              Flag.withDescription("Look back this many days"),
              Flag.withDefault(7),
            ),
            limit: Flag.integer("limit").pipe(
              Flag.withSchema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
              Flag.withDescription("Number of recent interventions"),
              Flag.withDefault(20),
            ),
            json: Flag.boolean("json").pipe(Flag.withDefault(false)),
          },
        }),
        Spec.make("paths", {
          description: "Show global paths (data, config, cache, state)",
          params: {
            name: Argument.choice("name", [
              "db",
              "home",
              "data",
              "config",
              "cache",
              "state",
              "tmp",
              "bin",
              "log",
              "repos",
            ]).pipe(
              Argument.withDescription(
                "Print only one path: db, home, data, config, cache, state, tmp, bin, log, repos",
              ),
              Argument.optional,
            ),
          },
        }),
      ],
    }),
    Spec.make("auth", {
      description: "manage integrations and credentials",
      aliases: ["providers"],
      commands: [
        Spec.make("list", {
          description: "list integrations and credentials",
          params: {
            ...ServerParams,
            format: Flag.choice("format", ["default", "json"]).pipe(
              Flag.withDescription("Output format"),
              Flag.withDefault("default"),
            ),
          },
        }),
        Spec.make("login", {
          description: "connect an integration",
          params: {
            ...ServerParams,
            target: Argument.string("target").pipe(
              Argument.withDescription("Integration ID, name, or well-known provider URL"),
              Argument.optional,
            ),
            method: Flag.string("method").pipe(Flag.withDescription("Authentication method ID"), Flag.optional),
            answer: Flag.string("answer").pipe(
              Flag.withDescription("Provider form answer (key=value; repeat for multiple fields)"),
              Flag.atMost(100),
            ),
          },
        }),
        Spec.make("logout", {
          description: "log out of a saved account",
          params: {
            ...ServerParams,
            target: Argument.string("target").pipe(
              Argument.withDescription("Integration ID or name"),
              Argument.optional,
            ),
            credential: Argument.string("credential").pipe(
              Argument.withDescription("Credential ID or label (opens an account picker when omitted)"),
              Argument.optional,
            ),
          },
        }),
        Spec.make("switch", {
          description: "switch the active account for an integration",
          params: {
            ...ServerParams,
            target: Argument.string("target").pipe(
              Argument.withDescription("Integration ID or name"),
              Argument.optional,
            ),
            credential: Argument.string("credential").pipe(
              Argument.withDescription("Credential ID or label (opens an account picker when omitted)"),
              Argument.optional,
            ),
          },
        }),
        Spec.make("remove", {
          description: "Remove a provider, its credentials, and global settings that use it",
          params: {
            ...ServerParams,
            target: Argument.string("provider").pipe(Argument.optional),
            yes: Flag.boolean("yes").pipe(Flag.withAlias("y"), Flag.withDefault(false)),
          },
        }),
      ],
    }),
    Spec.make("console", {
      description: "manage OpenCode Console organizations",
      commands: [
        Spec.make("orgs", { description: "list organizations for the active Console account", params: ServerParams }),
        Spec.make("switch", {
          description: "switch the active Console organization",
          params: {
            ...ServerParams,
            org: Argument.string("org").pipe(Argument.withDescription("Organization ID"), Argument.optional),
            account: Flag.string("account").pipe(Flag.withDescription("Console credential ID"), Flag.optional),
          },
        }),
        Spec.make("open", { description: "open the active Console account in a browser", params: ServerParams }),
      ],
    }),
    Spec.make("setup", {
      description: "configure System Two and optional System One reasoning",
      params: ServerParams,
    }),
    Spec.make("mcp", {
      description: "Manage MCP (Model Context Protocol) servers",
      commands: [
        Spec.make("list", { description: "List configured MCP servers and their status" }),
        Spec.make("add", {
          description: "Add an MCP server to your configuration",
          params: {
            name: Argument.string("name").pipe(Argument.withDescription("Name of the MCP server")),
            command: Argument.string("command").pipe(
              Argument.withDescription("Command and arguments for a local server, passed after --"),
              Argument.variadic({ min: 0 }),
            ),
            url: Flag.string("url").pipe(Flag.withDescription("URL for a remote MCP server"), Flag.optional),
            header: Flag.keyValuePair("header").pipe(
              Flag.withDescription("HTTP header for a remote server, as name=value"),
              Flag.optional,
            ),
            env: Flag.keyValuePair("env").pipe(
              Flag.withDescription("Environment variable for a local server, as name=value"),
              Flag.optional,
            ),
            global: Flag.boolean("global").pipe(
              Flag.withDescription("Write to the global config instead of the project config"),
              Flag.withDefault(false),
            ),
          },
        }),
        Spec.make("auth", {
          description: "Authenticate with an OAuth-capable remote MCP server",
          params: {
            name: Argument.string("name").pipe(Argument.withDescription("Name of the MCP server"), Argument.optional),
          },
        }),
        Spec.make("logout", {
          description: "Remove stored OAuth credentials for an MCP server",
          params: { name: Argument.string("name").pipe(Argument.withDescription("Name of the MCP server")) },
        }),
      ],
    }),
    Spec.make("plugin", {
      description: "Manage plugins",
      commands: [
        Spec.make("list", {
          description: "List plugins",
          params: {
            builtin: Flag.boolean("builtin").pipe(
              Flag.withDescription("Include built-in server plugins"),
              Flag.withDefault(false),
            ),
          },
        }),
        Spec.make("add", {
          description: "Install a plugin and add it to the global configuration",
          params: {
            package: Argument.string("package").pipe(Argument.withDescription("npm registry or Git package specifier")),
          },
        }),
        Spec.make("check", {
          description: "Check package plugins for updates",
          params: {
            target: Argument.string("target").pipe(
              Argument.withDescription("Configured package target"),
              Argument.optional,
            ),
          },
        }),
        Spec.make("update", {
          description: "Update package plugins",
          params: {
            target: Argument.string("target").pipe(
              Argument.withDescription("Configured package target; omit to update all outdated plugins"),
              Argument.optional,
            ),
          },
        }),
        Spec.make("remove", {
          description: "Remove a plugin from global configuration",
          params: {
            package: Argument.string("package").pipe(Argument.withDescription("configured package specifier")),
          },
        }),
      ],
    }),
    Spec.make("worktrees", {
      description: "Manage project worktrees",
      commands: [
        Spec.make("list", {
          description: "List worktrees with size, changes, branches, and sessions",
          params: { json: Flag.boolean("json").pipe(Flag.withDefault(false)) },
        }),
        Spec.make("clean", {
          description: "Remove clean merged or stale worktrees",
          params: {
            merged: Flag.boolean("merged").pipe(Flag.withDefault(false)),
            stale: Flag.integer("stale").pipe(Flag.optional),
            dryRun: Flag.boolean("dry-run").pipe(Flag.withDefault(false)),
            yes: Flag.boolean("yes").pipe(Flag.withAlias("y"), Flag.withDefault(false)),
          },
        }),
        Spec.make("create", {
          description: "Create a worktree using the project's selected strategy",
          params: {
            branch: Flag.string("branch").pipe(Flag.optional),
            name: Flag.string("name").pipe(Flag.optional),
            from: Flag.string("from").pipe(Flag.optional),
            directory: Flag.string("directory").pipe(Flag.optional),
          },
        }),
        Spec.make("remove", {
          description: "Remove a worktree by path, name, or branch",
          params: {
            target: Argument.string("target"),
            force: Flag.boolean("force").pipe(Flag.withDefault(false)),
            deleteBranch: Flag.boolean("delete-branch").pipe(Flag.withDefault(false)),
          },
        }),
        Spec.make("refresh", { description: "Discover and reconcile project worktrees" }),
      ],
    }),
    Spec.make("pr", {
      description: "Check out a GitHub pull request and open OpenCode",
      params: { number: Argument.integer("number") },
    }),
    Spec.make("generate", {
      description: "Print the server OpenAPI document",
      params: ServerParams,
    }),
    Spec.make("agent", {
      description: "Manage agents",
      commands: [
        Spec.make("list", {
          description: "List available agents",
          params: ServerParams,
        }),
        Spec.make("create", {
          description: "Generate an agent configuration",
          params: {
            ...ServerParams,
            path: Flag.string("path").pipe(
              Flag.withDescription("Configuration directory in which to create agents/<name>.md"),
              Flag.optional,
            ),
            description: Flag.string("description").pipe(
              Flag.withDescription("What the agent should do"),
              Flag.optional,
            ),
            mode: Flag.choice("mode", ["all", "primary", "subagent"]).pipe(Flag.optional),
            permissions: Flag.string("permissions").pipe(
              Flag.withAlias("tools"),
              Flag.withDescription("Comma-separated tool permissions to allow; other listed tools are denied"),
              Flag.optional,
            ),
            model: Flag.string("model").pipe(
              Flag.withAlias("m"),
              Flag.withDescription("Generation model as provider/model"),
              Flag.optional,
            ),
          },
        }),
      ],
    }),
    Spec.make("models", {
      description: "List all available models",
      params: ServerParams,
    }),
    Spec.make("usage", {
      description: "Manage the local usage sidecar",
      commands: [
        Spec.make("path", {
          description: "Print the usage sidecar path, or the V2 database path with --v2",
          params: {
            v2: Flag.boolean("v2").pipe(Flag.withDescription("Print the V2 session database path"), Flag.withDefault(false)),
          },
        }),
        Spec.make("backfill", {
          description: "Copy existing V2 usage into the local usage sidecar",
          params: {
            ...ServerParams,
            json: Flag.boolean("json").pipe(Flag.withDescription("Print the result as JSON"), Flag.withDefault(false)),
          },
        }),
      ],
    }),
    Spec.make("stats", {
      description: "Show shareable usage statistics",
      params: {
        ...ServerParams,
        days: Flag.integer("days").pipe(
          Flag.withSchema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
          Flag.withDescription("Show the last N days; 0 means today"),
          Flag.optional,
        ),
        year: Flag.integer("year").pipe(
          Flag.withSchema(Schema.Int.check(Schema.isBetween({ minimum: 1970, maximum: 9_999 }))),
          Flag.withDescription("Show a calendar year"),
          Flag.optional,
        ),
        all: Flag.boolean("all").pipe(Flag.withDescription("Show lifetime statistics"), Flag.withDefault(false)),
        project: Flag.string("project").pipe(
          Flag.withDescription('Filter by project ID, or use "." for the current project'),
          Flag.optional,
        ),
        models: Flag.boolean("models").pipe(Flag.withDescription("Show model usage"), Flag.withDefault(false)),
        tools: Flag.boolean("tools").pipe(Flag.withDescription("Show tool reliability"), Flag.withDefault(false)),
        cost: Flag.boolean("cost").pipe(Flag.withDescription("Show cost and token details"), Flag.withDefault(false)),
        full: Flag.boolean("full").pipe(Flag.withDescription("Show every detailed section"), Flag.withDefault(false)),
        limit: Flag.integer("limit").pipe(
          Flag.withSchema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
          Flag.withDescription("Number of rows in detailed sections"),
          Flag.withDefault(5),
        ),
        json: Flag.boolean("json").pipe(Flag.withDescription("Output statistics as JSON"), Flag.withDefault(false)),
      },
    }),
    Spec.make("mini", {
      description: "Start the minimal interactive interface",
      params: {
        ...ServerParams,
        continue: Flag.boolean("continue").pipe(
          Flag.withAlias("c"),
          Flag.withDescription("Continue the last session"),
          Flag.withDefault(false),
        ),
        session: Flag.string("session").pipe(
          Flag.withAlias("s"),
          Flag.withDescription("Session ID to continue"),
          Flag.optional,
        ),
        fork: Flag.boolean("fork").pipe(
          Flag.withDescription("Fork the session when continuing"),
          Flag.withDefault(false),
        ),
        replay: Flag.boolean("replay").pipe(
          Flag.withDescription("Restore session history on resume and resize (disable with --no-replay)"),
          Flag.optional,
        ),
        replayLimit: Flag.integer("replay-limit").pipe(
          Flag.withDescription("Limit replay to the newest N messages (default: 200)"),
          Flag.optional,
        ),
        model: Flag.string("model").pipe(
          Flag.withAlias("m"),
          Flag.withDescription("Model to use in the format provider/model"),
          Flag.optional,
        ),
        agent: Flag.string("agent").pipe(Flag.withDescription("Agent to use"), Flag.optional),
        prompt: Flag.string("prompt").pipe(Flag.withDescription("Prompt to use"), Flag.optional),
        demo: Flag.boolean("demo").pipe(Flag.withDefault(false), Flag.withHidden),
      },
    }),
    Spec.make("run", {
      description: "Run OpenCode with a message",
      params: {
        ...ServerParams,
        message: Argument.string("message").pipe(
          Argument.withDescription("Message to send"),
          Argument.variadic({ min: 0 }),
        ),
        continue: Flag.boolean("continue").pipe(
          Flag.withAlias("c"),
          Flag.withDescription("Continue the last session"),
          Flag.withDefault(false),
        ),
        session: Flag.string("session").pipe(
          Flag.withAlias("s"),
          Flag.withDescription("Session ID to continue"),
          Flag.optional,
        ),
        fork: Flag.boolean("fork").pipe(
          Flag.withDescription("Fork the session before continuing"),
          Flag.withDefault(false),
        ),
        model: Flag.string("model").pipe(
          Flag.withAlias("m"),
          Flag.withDescription("Model to use in the format provider/model#variant"),
          Flag.optional,
        ),
        agent: Flag.string("agent").pipe(Flag.withDescription("Agent to use"), Flag.optional),
        format: Flag.choice("format", ["default", "json"]).pipe(
          Flag.withDescription("Output format"),
          Flag.withDefault("default"),
        ),
        file: Flag.string("file").pipe(
          Flag.withAlias("f"),
          Flag.withDescription("File to attach to the message"),
          Flag.atMost(100),
        ),
        title: Flag.string("title").pipe(Flag.withDescription("Session title"), Flag.optional),
        thinking: Flag.boolean("thinking").pipe(Flag.withDescription("Show thinking blocks"), Flag.withDefault(false)),
        ...PermissionParams,
      },
    }),
    Spec.make("github", {
      description: "Manage the GitHub agent",
      commands: [
        Spec.make("install", { description: "Install the GitHub agent workflow in this repository" }),
        Spec.make("run", {
          description: "Run the GitHub agent for the current Actions event",
          params: {
            event: Flag.string("event").pipe(Flag.withDescription("GitHub event payload for a local run"), Flag.optional),
            token: Flag.string("token").pipe(Flag.withDescription("GitHub token for a local run"), Flag.optional),
          },
        }),
      ],
    }),
    Spec.make("session", {
      description: "Manage sessions",
      commands: [
        Spec.make("import-redcode", {
          description: "Import sessions and Redcode data from a V1 SQLite database",
          params: {
            file: Argument.string("file").pipe(Argument.withDescription("Path to the Redcode SQLite database")),
          },
        }),
        Spec.make("rebind-share", {
          description: "Restore the Console account and organization for an imported V1 share",
          params: {
            ...ServerParams,
            sessionID: Argument.string("sessionID").pipe(Argument.withDescription("Imported session ID")),
            credentialID: Argument.string("credentialID").pipe(Argument.withDescription("Console credential ID from console orgs")),
            orgID: Argument.string("orgID").pipe(Argument.withDescription("Console organization ID from console orgs")),
          },
        }),
        Spec.make("list", {
          description: "List top-level sessions in the current project, newest first",
          params: {
            ...ServerParams,
            maxCount: Flag.integer("max-count").pipe(
              Flag.withAlias("n"),
              Flag.withSchema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
              Flag.withDescription("Limit to N most recent sessions (default: 100)"),
              Flag.optional,
            ),
            format: Flag.choice("format", ["table", "json"]).pipe(
              Flag.withDescription("Output format"),
              Flag.withDefault("table"),
            ),
          },
        }),
        Spec.make("delete", {
          description: "Delete a session and its child sessions",
          params: {
            ...ServerParams,
            sessionID: Argument.string("sessionID").pipe(Argument.withDescription("Session ID to delete")),
          },
        }),
        Spec.make("export", {
          description: "Export session data as JSON",
          params: {
            ...ServerParams,
            session: Argument.string("session").pipe(
              Argument.withDescription("Session ID to export"),
              Argument.optional,
            ),
            sanitize: Flag.boolean("sanitize").pipe(
              Flag.withDescription("Redact sensitive transcript and file data"),
              Flag.withDefault(false),
            ),
          },
        }),
        Spec.make("import", {
          description: "Import session data from a JSON file or URL",
          params: {
            ...ServerParams,
            file: Argument.string("file").pipe(Argument.withDescription("JSON file or URL to import")),
            directory: Flag.string("directory").pipe(
              Flag.withDescription("Directory in which to import the session"),
              Flag.optional,
            ),
          },
        }),
      ],
    }),
    Spec.make("service", {
      description: "Manage the background server",
      commands: [
        Spec.make("start", { description: "Start the background server" }),
        Spec.make("restart", { description: "Restart the background server" }),
        Spec.make("status", { description: "Show background server status" }),
        Spec.make("stop", { description: "Stop the background server" }),
        Spec.make("get", {
          description: "Get service configuration",
          params: {
            key: Argument.string("key").pipe(Argument.withDescription("Service setting or env"), Argument.optional),
            name: Argument.string("name").pipe(
              Argument.withDescription("Environment variable name"),
              Argument.optional,
            ),
          },
        }),
        Spec.make("set", {
          description: "Set service configuration",
          params: {
            key: Argument.string("key").pipe(Argument.withDescription("Service setting or env")),
            value: Argument.string("value").pipe(
              Argument.withDescription("Setting value or environment variable name"),
            ),
            nestedValue: Argument.string("env-value").pipe(
              Argument.withDescription("Environment variable value"),
              Argument.optional,
            ),
          },
        }),
        Spec.make("unset", {
          description: "Unset service configuration",
          params: {
            key: Argument.string("key").pipe(Argument.withDescription("Service setting or env")),
            name: Argument.string("name").pipe(
              Argument.withDescription("Environment variable name"),
              Argument.optional,
            ),
          },
        }),
      ],
    }),
    Spec.make("reload", {
      description: "Reload configuration",
      params: {
        ...ServerParams,
      },
    }),
    Spec.make("pair", {
      description: "Print one-time links to connect a browser or app",
      params: {
        url: Flag.string("url").pipe(
          Flag.withDescription("Use an external HTTP(S) server URL in pairing links"),
          Flag.mapTryCatch(
            (value) => {
              const url = new URL(value)
              if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
                throw new Error("Invalid pairing URL")
              return url.href.replace(/\/+$/, "")
            },
            () => "Expected an HTTP(S) server URL without credentials, query parameters, or a fragment",
          ),
          Flag.optional,
        ),
      },
    }),
    Spec.make("design", {
      description: "Open the browser review for a Design session",
      params: {
        ...ServerParams,
        sessionID: Argument.string("sessionID").pipe(Argument.withDescription("Session ID to review")),
        noOpen: Flag.boolean("no-open").pipe(
          Flag.withDescription("Print the review link without opening a browser"),
          Flag.withDefault(false),
        ),
      },
    }),
    Spec.make("serve", {
      description: "Start the v2 API and web server",
      params: {
        hostname: Flag.string("hostname").pipe(Flag.optional),
        port: Flag.integer("port").pipe(Flag.optional),
        cors: Flag.string("cors").pipe(
          Flag.withSchema(Schema.NonEmptyString),
          Flag.withDescription("Additional allowed CORS origin (repeat for multiple origins)"),
          Flag.atLeast(0),
        ),
        service: Flag.boolean("service").pipe(Flag.withDefault(false)),
        stdio: Flag.boolean("stdio").pipe(Flag.withDefault(false)),
      },
    }),
  ],
})

export const Commands = Root
