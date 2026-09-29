import { Effect, Option } from "effect"

/**
 * `--reasoning` sets `REDCODE_REASONING` for a server this invocation starts, so it overrides the saved mode
 * exactly like the environment variable. The shared background service and an explicit `--server` keep their own
 * mode, so outside `serve` the flag requires `--standalone` instead of silently doing nothing.
 */
export function applyReasoningFlag(
  input: { readonly reasoning: Option.Option<"single" | "dual">; readonly standalone: boolean },
  env: Record<string, string | undefined> = process.env,
) {
  const reasoning = Option.getOrUndefined(input.reasoning)
  if (reasoning === undefined) return Effect.void
  if (!input.standalone)
    return Effect.fail(
      new Error("--reasoning requires --standalone: the background service keeps its own reasoning mode"),
    )
  return Effect.sync(() => {
    env.REDCODE_REASONING = reasoning
  })
}
