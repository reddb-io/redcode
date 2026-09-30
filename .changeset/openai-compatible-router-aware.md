---
"@reddb-io/redcode": minor
---

Connecting an OpenAI-compatible endpoint now recognizes a RedRouter (by its capabilities document, or by serving only System One models) and files it as the RedRouter integration, so the router keeps its catalog, routes, key role and capabilities however it was added. For any other endpoint, a model limit the endpoint's `/models` does not report is taken from the models catalog by model id, dropping router prefixes such as `openai/` or `cc/`, before falling back to a conservative guess that provider size refusals correct later.
