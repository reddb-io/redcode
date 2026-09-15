---
"@reddb-io/redcode": minor
---

Compaction in large windows and user control over it. The kept tail is a tenth of the usable window (8k to 60k tokens) and always includes the last turn. Old tool output is trimmed, on by default, when that alone brings the context under the limit (the summary is then skipped) or once the provider cache has expired; a trim is permanent, and the placeholder points the model at `session_history` instead of re-running the tool (`compaction.prune: false` turns it off). The summary request reuses the conversation's cached prefix where the provider supports it, is capped at 16k output tokens, and folds oversized histories in windows. Summaries end with code-built anchors (files, identifiers, the user's messages), and tools loaded through tool_search stay loaded. `/compact <focus>` steers the summary, and the new read-only `session_history` tool searches compacted-away messages.
