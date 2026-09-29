---
"@reddb-io/redcode": minor
---

End the turn at once when a rate limit or quota resets more than two minutes away, with a message naming the provider, model, and local reset time (`quota exhausted until …; switch model with /model or wait`), instead of waiting up to fifteen minutes. The reset is read from Retry-After, the router's retry-at header, or an "until <time>" in the error. Selecting another model while a retry wait is pending ends the wait and continues with the new model on fresh attempts.

Restore the `/connect` wizard for any OpenAI-compatible endpoint: base URL, provider ID, display name, Chat Completions or Responses API, optional model IDs, extra headers, and context and output limits. Connecting checks the key and URL against the endpoint's `/models`, discovers its models, writes the provider to the global configuration, and keeps the key in the credential store.
