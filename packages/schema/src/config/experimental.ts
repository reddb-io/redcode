export * as ConfigExperimental from "./experimental.js"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt, optional } from "../schema.js"
import { ConfigPolicy } from "./policy.js"

export class Info extends Schema.Class<Info>("ConfigExperimental.Info")({
  reasoning_self_review: Schema.Boolean.pipe(optional).annotate({
    description:
      "Give single reasoning one bounded code self-review using the same scoped repair limits. Evaluation control, off by default.",
  }),
  reasoning_code_repair: Schema.Boolean.pipe(optional).annotate({
    description:
      "Review candidate code snapshots and allow one scoped repair of at most four Steps with existing permissions and test commands. Off by default.",
  }),
  reasoning_verification: Schema.Boolean.pipe(optional).annotate({
    description: "Allow at most one bounded S2 verification Step after a confident S1 response issue. Off by default.",
  }),
  reasoning_tool_selection: Schema.Boolean.pipe(optional).annotate({
    description:
      "Rank the existing partial Code Mode catalog using S1 namespace recommendations. Full search remains available. Off by default.",
  }),
  reasoning_context_curation: Schema.Boolean.pipe(optional).annotate({
    description:
      "Omit dispensable old read-only assistant blocks from the model request with an inspectable manifest. Original history remains intact. Off by default.",
  }),
  reasoning_learning: Schema.Boolean.pipe(optional).annotate({
    description:
      "Propose evidence-backed learning candidates after a successful correction. Never installs memories or skills. Off by default.",
  }),
  portable_shell_scanner: Schema.Boolean.pipe(optional).annotate({
    description: "Enable the experimental portable shell permission scanner. Defaults to false.",
  }),
  subagent_depth: NonNegativeInt.pipe(optional).annotate({
    description: "Maximum subagent nesting depth. Defaults to 2.",
  }),
  subagent_limits: Schema.Struct({
    concurrent: PositiveInt.pipe(optional).annotate({
      description:
        "Foreground subagents one session may have in flight at once; past it the subagent tool refuses and asks the model to wait for one. Defaults to 8.",
    }),
    per_request: PositiveInt.pipe(optional).annotate({
      description:
        "New subagents one session may start for a single user message; past it the subagent tool refuses and asks the model to finish with what it has. Defaults to 24.",
    }),
  })
    .pipe(optional)
    .annotate({ description: "Fan-out caps on the subagent tool. Nesting depth is bounded by subagent_depth." }),
  background_subagents_max: PositiveInt.pipe(optional).annotate({
    description:
      "Background subagents one session may have running at once; past it the subagent tool refuses and asks the model to wait or run the task in the foreground. Defaults to 8.",
  }),
  subtask_concurrency: PositiveInt.pipe(optional).annotate({
    description:
      "Foreground subagents of one session that run at the same time; further admitted calls wait for a slot and start in the order they were made. Defaults to 8.",
  }),
  loop_guard: Schema.Union([
    Schema.Literal(false),
    Schema.Struct({
      correct_at: PositiveInt.pipe(optional),
      stop_at: PositiveInt.pipe(optional),
      nudge_at: PositiveInt.pipe(optional),
    }),
  ])
    .pipe(optional)
    .annotate({ description: "Repeated tool-call limits; false disables the loop guard." }),
  stop_loss: Schema.Union([
    Schema.Literal(false),
    Schema.Struct({
      every: NonNegativeInt.pipe(optional),
      cooldown: PositiveInt.pipe(optional),
      idle_at: PositiveInt.pipe(optional),
      tokens: PositiveInt.pipe(optional),
      minutes: PositiveInt.pipe(optional),
    }),
  ])
    .pipe(optional)
    .annotate({
      description: "Progress checkpoints across Steps; false disables the stop-loss.",
    }),
  aux_timeout: Schema.Union([Schema.Literal(false), NonNegativeInt])
    .pipe(optional)
    .annotate({
      description: "Deadline in milliseconds for auxiliary model calls; false disables it.",
    }),
  turn_steps: Schema.Union([Schema.Literal(false), PositiveInt])
    .pipe(optional)
    .annotate({
      description:
        "Steps one turn may run when its agent sets no steps of its own; the last one runs with tools disabled and asks for a report of what was done and what is left. New user input starts the count over. Defaults to 400; false removes the ceiling.",
    }),
  turn_stall: Schema.Union([
    Schema.Literal(false),
    Schema.Struct({
      warn_ms: PositiveInt.pipe(optional),
      abort_ms: PositiveInt.pipe(optional),
    }),
  ])
    .pipe(optional)
    .annotate({
      description: "Warn when a Step produces no output, and end unattended Steps after a longer silence.",
    }),
  tool_timeout: Schema.Union([Schema.Literal(false), NonNegativeInt])
    .pipe(optional)
    .annotate({
      description:
        "Deadline in milliseconds for a local tool call, excluding time spent waiting for a person; false disables it.",
    }),
  model_suggestions: Schema.Boolean.pipe(optional).annotate({
    description:
      "Offer a card to switch to another model of a connected RedRouter when its recommend_models tool suggests one, asked by the agent or by Redcode when the session needs vision or tools the model lacks, nears its context limit, keeps failing at the provider or runs out of quota, or has a much cheaper equivalent; nothing switches until you accept. Defaults to true.",
  }),
  code_mode: Schema.Struct({
    enabled: Schema.Literals(["off", "on"]).pipe(optional).annotate({
      description:
        'Call tools from a confined JavaScript program through the execute tool: "on" enables it. Defaults to "off", which advertises every tool directly.',
    }),
    max_tool_calls: PositiveInt.pipe(optional).annotate({
      description: "Tool calls one program may make before it is stopped. Defaults to 100.",
    }),
    timeout_ms: PositiveInt.pipe(optional).annotate({
      description:
        "Milliseconds one program may run, not counting time spent waiting for a person. Defaults to 240000.",
    }),
    max_output_bytes: PositiveInt.pipe(optional).annotate({
      description: "Bytes of program result and logs kept before the result is cut. Defaults to 2000000.",
    }),
  })
    .pipe(optional)
    .annotate({ description: "Code Mode: tools called from a confined program. Off by default." }),
  policies: ConfigPolicy.Info.pipe(Schema.Array, optional).annotate({
    description: "Ordered policies controlling access to configured resources",
  }),
}) {}
