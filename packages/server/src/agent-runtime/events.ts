import { Harness } from "@opencode/schema/harness"
import { UsageReporter } from "@opencode/schema/usage-reporter"
import { type Frame } from "../harness-wire"

export type AgentRuntimeMetric = {
  cost: number | null
  identity: string
  model?: string | null
  pricing?: "reported" | "estimated"
  scope: "interaction" | "session"
  status: UsageReporter.Record["status"]
  tokens: UsageReporter.Record["tokens"]
}

export type AgentRuntimeEvent =
  | { type: "activity"; text: string }
  | {
      type: "completed"
      detail?: string
      metrics: AgentRuntimeMetric[]
      nativeID?: string
      outcome: "completed" | "failed" | "interrupted"
    }
  | { type: "request.resolved"; id: string }
  | {
      type: "request"
      detail: string
      frame: Frame
      key: string
      questions: Harness.Request["questions"]
      supported: boolean
      title: string
    }
  | { type: "session"; nativeID: string }
  | { type: "started"; turn: string }
  | { type: "text"; text: string }
  | { type: "usage"; metric: AgentRuntimeMetric }

export type AgentRuntimeEventInput = {
  frame: Frame
  inputID?: string
  run: Harness.Run
  turn: string
}
