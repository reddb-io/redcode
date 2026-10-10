---
"@reddb-io/redcode": minor
---

The desktop and web app now manage models and connections the way the TUI does. The model picker lists every connected model with Favorites, Recent and per-route sections, fuzzy search, route, alias, subscription and offer details, a favorite star (Ctrl/Cmd+F), Refresh, and a variant step; commands cycle recent (F2) and favorite models. The connect list follows the TUI's order with RedRouter and 9router first, shows each connection's status, lets a provider hold several accounts, runs login commands, and returns to the model picker after connecting. "Custom OpenAI-compatible provider" now connects through the working OpenAI-compatible endpoint wizard instead of a form that always failed, and local servers such as Ollama, LM Studio and vLLM are easy to find. Settings › Providers can rename connections, test the remote API, and announces router catalog updates.
