import type { SessionMessageInfo } from "@opencode/client/promise"

// Ten thousand tokens, including reasoning and both cache counts, in the mock model's 200K window.
export const contextMessages: SessionMessageInfo[] = [
  { id: "msg_context_prompt", type: "user", text: "Measure context", time: { created: 1 } },
  {
    id: "msg_context_reply",
    type: "assistant",
    agent: "build",
    model: { id: "test", providerID: "opencode" },
    content: [{ type: "text", text: "Measured response" }],
    time: { created: 2, completed: 3 },
    tokens: { input: 1000, output: 2000, reasoning: 3000, cache: { read: 1500, write: 2500 } },
    cost: 0.2,
  },
]
