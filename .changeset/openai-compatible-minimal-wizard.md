---
"@reddb-io/redcode": minor
---

Connecting an OpenAI-compatible endpoint now asks for the API base URL and the key, and nothing else. The models and their context and output limits are read from the endpoint's `/models` (now also from the fields vLLM, LM Studio, OpenRouter and llama.cpp use), and the provider ID and display name come from the host, with a suffix if that ID is taken. The provider ID, display name, API, extra headers, model IDs and limits moved behind one "Customize the connection?" question that defaults to no.
