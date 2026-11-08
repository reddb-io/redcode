import { Plugin } from "@opencode/core/plugin"
import { Skill } from "@opencode/core/skill"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const SkillHandler = HttpApiBuilder.group(Api, "server.skill", (handlers) =>
  handlers.handle("skill.list", () =>
    Effect.gen(function* () {
      yield* Plugin.awaitActivation
      return yield* response(Skill.Service.use((skill) => skill.list()))
    }),
  ),
)
