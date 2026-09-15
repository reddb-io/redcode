---
"@reddb-io/redcode": minor
"@reddb-io/redcode-llm": minor
---

Use the provider's own tool search for deferred MCP and Design tools where the model supports it. On Anthropic (Claude 4.5 and later on the Anthropic API) every deferred tool is sent with `defer_loading` next to the BM25 tool search tool, in both the AI SDK and the native runtime. On OpenAI Responses (GPT-5.4 and later, AI SDK runtime) deferred tools are sent as deferred functions grouped in one namespace per MCP server, next to the hosted `tool_search`. The provider loads matches without touching the cached prefix, so a step that loads a tool no longer re-bills the system prompt and history. Other providers keep the client-side `tool_search`. Search calls persist, replay on the next request, and show as a compact "Tool search" row in the TUI. If a provider rejects the request with a 400 about the search tool or deferral, the step is retried once with `tool_search`, native search stays off for that model for the rest of the process, and a warning is logged. Configure with `experimental.tool_search.native` (`"auto" | true | false`).
