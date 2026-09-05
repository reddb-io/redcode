---
"@reddb-io/redcode": patch
---

A message injected without an agent stays in the conversation's agent

Design feedback from the browser, orphan recovery and plugin-injected prompts name no agent. They used to land on the default agent, which flipped a plan or design session back to build. A prompt without an agent now continues the agent of the last user message; only a session with no history takes the default.
