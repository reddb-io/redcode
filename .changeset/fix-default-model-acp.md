---
"opencode": patch
---

Fix the ACP default model selection so a configured `model` is honored even when its provider has not finished loading yet. Previously, `defaultModelFromConfig` would skip the configured model when the provider lookup failed and fall back to the built-in `opencode` provider, snapping the footer back to big-pickle whenever sessions switched modes (build → plan → build) or the directory was re-evaluated. The configured model now always wins; any fallback is computed from the connected providers.
