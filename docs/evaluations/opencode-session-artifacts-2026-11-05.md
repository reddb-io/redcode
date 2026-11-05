# OpenCode artifacts and Redcode

Assessment on 5 November 2026 against OpenCode `dev` at [`79de5cb52dca5f31fd63fee73ba146f875f4b1a1`](https://github.com/anomalyco/opencode/commit/79de5cb52dca5f31fd63fee73ba146f875f4b1a1). This is a code comparison, not a live security audit or a promise of equivalent behavior.

## What OpenCode provides

The feature is experimental and disabled by default. The [implementation PR](https://github.com/anomalyco/opencode/pull/60351) describes agent tools, HTTP and SDK access, a local static-file provider and a plugin provider interface. The [current schema](https://github.com/anomalyco/opencode/blob/79de5cb52dca5f31fd63fee73ba146f875f4b1a1/packages/schema/src/artifact.ts) represents a title, entry file, URL, provider, timestamps and optional Session ID. A provider can declare static, server-code, SQLite or durable-object capabilities; these declarations do not mean the built-in local provider implements them.

The [current core](https://github.com/anomalyco/opencode/blob/79de5cb52dca5f31fd63fee73ba146f875f4b1a1/packages/core/src/artifact.ts) stores metadata by artifact ID, scopes records by project, validates relative paths, and replaces local files on update. The [HTTP handler](https://github.com/anomalyco/opencode/blob/79de5cb52dca5f31fd63fee73ba146f875f4b1a1/packages/server/src/handlers/artifact.ts) resolves the owning location for direct links and serves local previews with `content-security-policy: sandbox allow-scripts`. Session association is optional. The current schema and update path do not expose retained versions or a base-version conflict check; PR comments about these refer to review history, not necessarily the merged contract.

## What is different in Redcode

Redcode Design already has session-bound designs, revision history, explicit review and approval, and a sandboxed review frame; see `docs/agent-features.md` and `packages/core/src/design/prompt.ts`. That is a richer review workflow for prototypes, but it is not a general inventory for arbitrary reports, generated HTML, images or downloadable files. Worker result artifacts and Design exports serve different purposes and should not be conflated with a shareable conversation artifact.

## Recommended first slice

1. Introduce a session-owned artifact record and list in the existing conversation Delivery area, with title, type, owner, creation time and explicit open/download actions. Agent-created reports and static multi-file demos are the first use cases; existing Design revisions remain in Design.
2. Store immutable revisions with an explicit expected revision for updates, so concurrent agents cannot silently overwrite each other. Define retention and deletion with the owning session and preserve links across server restart and remote clients.
3. Start with a local provider and opt-in creation. View active content in a sandboxed, isolated origin; test that scripts cannot use Redcode credentials or call the server as the user. Define authentication for desktop, browser, paired mobile and remote servers, and keep private files private. Test path traversal, size limits, MIME handling and attachment downloads.
4. Add a provider interface only after local ownership and lifecycle are stable. External hosting and capabilities that execute server code need explicit configuration and a clear publication action, rather than implicit deployment.

Do not reuse a preview URL as an authorization boundary, claim exactly-once external publication, or assume a worker filesystem is accessible to the coordinator. Test session moves, fork and deletion, concurrency, restart, large files and servers without the feature before implementation is considered ready.
