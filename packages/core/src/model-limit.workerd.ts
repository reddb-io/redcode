import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { ModelLimit } from "./model-limit.js"

export const modelLimitNode = makeGlobalNode({ service: ModelLimit.Service, layer: ModelLimit.memoryLayer(), deps: [] })
