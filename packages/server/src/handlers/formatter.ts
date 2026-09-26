import { Formatter } from "@opencode/core/formatter"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const FormatterHandler = HttpApiBuilder.group(Api, "server.formatter", (handlers) =>
  handlers.handle("formatter.status", () => response(Formatter.Service.use((formatter) => formatter.status()))),
)
