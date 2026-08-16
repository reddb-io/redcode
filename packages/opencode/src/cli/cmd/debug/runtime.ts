import { EOL } from "os"
import { Effect } from "effect"
import { LocationServiceMap, locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { Location } from "@opencode-ai/core/location"
import { RuntimeInspection } from "@opencode-ai/core/runtime-inspection"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { effectCmd } from "../../effect-cmd"

export const RuntimeCommand = effectCmd({
  command: "runtime",
  describe: "debug the booted runtime composition (profile, services, invariants)",
  instance: false,
  builder: (yargs) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "print the inspection payload as JSON",
    }),
  handler: (args) =>
    Effect.gen(function* () {
      const inspection = yield* RuntimeInspection.Service
      const payload = yield* inspection.inspect
      process.stdout.write((args.json ? JSON.stringify(payload, null, 2) : renderRuntimeInspection(payload)) + EOL)
    }).pipe(
      Effect.withSpan("Cli.debug.runtime"),
      Effect.provide(
        LocationServiceMap.Service.get(
          Location.Ref.make({
            directory: AbsolutePath.make(process.cwd()),
          }),
        ),
      ),
      Effect.provide(locationServiceMapLayer),
    ),
})

export function renderRuntimeInspection(payload: RuntimeInspection.Payload) {
  return [
    `profile: ${payload.profile.name ?? "none"} (${payload.profile.plugins.length} plugins)`,
    ...payload.profile.plugins.map((id) => `  ${id}`),
    "",
    `services: ${payload.services.length}`,
    ...payload.services.map(
      (entry) =>
        `  ${entry.name}${entry.tag ? ` [${entry.tag}]` : ""}${entry.kind === "unbound" ? " [unbound]" : ""}` +
        (entry.dependencies.length > 0 ? `${EOL}    depends on: ${entry.dependencies.join(", ")}` : ""),
    ),
    "",
    `invariants: ${payload.invariants.length}`,
    ...payload.invariants.map(
      (result) => `  ${result.owner}: ${result.ok ? "ok" : `FAILED ${result.error ?? "unknown"}`}`,
    ),
  ].join(EOL)
}
