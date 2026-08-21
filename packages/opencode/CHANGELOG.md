# opencode

## 0.11.0

### Minor Changes

- 3f7128c: Add observable start and end lifecycle events around each agent turn.

### Patch Changes

- 0df4500: Run EventV2 serial dispatch listeners sequentially instead of concurrently.
- 3b8372f: Expose V2 compatibility surfaces alongside legacy plugin hooks for agent pre-step and pre-system transforms, tool post-execution, command pre-execution, permission requests, compaction preparation, and completed text. Preserve mutations produced by legacy hooks as the default input for the new waterfall stages.

## 0.10.0

### Minor Changes

- 2861f34: Introduce capability seams for filesystem, shell, subprocess and LSP, plus the V2 plugin-context surface to register additional backends. The harness is now composable per-location without touching core: a plugin can install a remote FS, an SSH-backed shell, or a Docker sandbox and consumers keep talking to the same service tag.
  - `packages/core/src/capability/{filesystem,shell,process}.ts` and `packages/opencode/src/capability/lsp.ts` define `Interface` (consumer surface), `Backend` (provider shape) and a default `Local` backend that wraps the existing implementation.
  - `packages/core/src/capability/registry.ts` exposes `CapabilityRegistry.Service` with per-capability `register(backend): Registration` — plugins install a second backend and `dispose` removes it on scope exit.
  - `packages/core/src/capability/shell/ssh.ts` ships a minimal real SSH shell backend (`ShellService.Backend` over ssh2) as the proof that the seam accepts a second provider.
  - `packages/plugin/src/v2/effect/{capability,context}.ts` exposes `ctx.capability.{filesystem,shell,process}.register` to V2 plugins.
  - `packages/opencode/src/plugin/index.ts` logs a one-line deprecation warning when a V1 plugin loads through the legacy `server()` hook, pointing at the V2 surface.

  The full V1→V2 hook translation shim is intentionally out of scope for this release and lands in the next minor; this PR makes the seams available and signals the migration path.

## 0.9.0

### Minor Changes

- d7114e2: Introduce capability seams for filesystem, shell, subprocess and LSP, plus the V2 plugin-context surface to register additional backends. The harness is now composable per-location without touching core: a plugin can install a remote FS, an SSH-backed shell, or a Docker sandbox and consumers keep talking to the same service tag.
  - `packages/core/src/capability/{filesystem,shell,process}.ts` and `packages/opencode/src/capability/lsp.ts` define `Interface` (consumer surface), `Backend` (provider shape) and a default `Local` backend that wraps the existing implementation.
  - `packages/core/src/capability/registry.ts` exposes `CapabilityRegistry.Service` with per-capability `register(backend): Registration` — plugins install a second backend and `dispose` removes it on scope exit.
  - `packages/core/src/capability/shell/ssh.ts` ships a minimal real SSH shell backend (`ShellService.Backend` over ssh2) as the proof that the seam accepts a second provider.
  - `packages/plugin/src/v2/effect/{capability,context}.ts` exposes `ctx.capability.{filesystem,shell,process}.register` to V2 plugins.
  - `packages/opencode/src/plugin/index.ts` logs a one-line deprecation warning when a V1 plugin loads through the legacy `server()` hook, pointing at the V2 surface.

  The full V1→V2 hook translation shim is intentionally out of scope for this release and lands in the next minor; this PR makes the seams available and signals the migration path.

## 0.8.4

### Patch Changes

- 70164dc: Surface redskilled status more clearly in the Workers tab. Adds a red "✗ N failed" badge in the header for stuck workers, a blinking dot when the daemon is live, idle-state CTAs (`[start drain]` / `[z resize]`) instead of plain text, and a "tracking Xs" indicator driven by a `trackingSince` signal that stamps on the first payload.

## 0.8.3

### Patch Changes

- e10ce05: Fix the ACP default model selection so a configured `model` is honored even when its provider has not finished loading yet. Previously, `defaultModelFromConfig` would skip the configured model when the provider lookup failed and fall back to the built-in `opencode` provider, snapping the footer back to big-pickle whenever sessions switched modes (build → plan → build) or the directory was re-evaluated. The configured model now always wins; any fallback is computed from the connected providers.

## 0.8.2

### Patch Changes

- 7b580fd: Fix the ACP default model selection so a configured `model` is honored even when its provider has not finished loading yet. Previously, `defaultModelFromConfig` would skip the configured model when the provider lookup failed and fall back to the built-in `opencode` provider, snapping the footer back to big-pickle whenever sessions switched modes (build → plan → build) or the directory was re-evaluated. The configured model now always wins; any fallback is computed from the connected providers.

## 0.8.1

### Patch Changes

- ccaf6e3: Stop reading the legacy `~/.config/redcode/` XDG directory. Global config now comes only from `~/.red/redcode/` (`config.jsonc` primary, `redcode.*` / `opencode.*` still merged beneath it). Stale generated files left in the XDG directory — e.g. a `provider.minimax` block pointing at the dead `api.minimax.chat` endpoint — no longer leak into the merged config.
- 9d9ae8e: TUI: the `/connect` API key dialog now shows a busy spinner while the credential is saved and the instance re-bootstraps, and surfaces save failures as a toast. Previously the dialog looked frozen for the duration of the reload (tens of seconds when plugins or provider packages are reinstalled) and every extra `enter` re-submitted the key.

## 0.8.0

### Minor Changes

- 69252bd: Add a responsive two-column sidebar. Narrow terminals and the overlay layout keep the existing single-column surface. Wide terminals gain a Session column for Context, Todo, and modified files, plus a Project column for MCP and LSP, with the title and footer spanning the full sidebar width. The existing `sidebar_content` slot stays compatible; new Project-scoped surfaces register via the `sidebar_project` slot.

### Patch Changes

- c00206b: Move the global config directory from `~/.config/redcode/` to the RedDB family at `~/.red/redcode/` and rename the global config file to `config.jsonc` (with `config.json` as an alias). The XDG directory is still read as a fallback so existing installs keep working without manual migration; the transitional `redcode.json` / `redcode.jsonc` and the legacy `opencode.json` / `opencode.jsonc` names are still read everywhere the primary `config.*` name is, and the primary file always wins on merge.

## 0.7.0

### Minor Changes

- ba92896: Enable native language servers and agent semantic tools by default, and surface language-server initialization failures in status views.
- 813cfe7: Add the RedDB-derived Redcode TUI theme as the default while preserving the legacy OpenCode theme as an explicit option.

### Patch Changes

- af92e75: Finish Redcode branding across terminal surfaces and keep generated session titles focused on user intent instead of unsupported repository findings.

## 0.6.0

### Minor Changes

- 34e796e: Move the RedSkills dashboard and controls onto redskilled's public stdio ACP adapter, route work decisions through generic ACP turns, and remove Redcode-owned consent and control state.

### Patch Changes

- e027128: Reject provider config that sets `npm` when the resolved provider package disagrees, instead of silently dropping the override. A `providers.<id>` block could override the endpoint (through `api.url` or `request.body.baseURL`) while its `npm` key was discarded as an unknown property, so the catalog's SDK was combined with the configured host into an endpoint neither source describes — for example the Anthropic `/v1/messages` path sent to an OpenAI-compatible host. The conflict now fails at config resolution with a message naming the requested package, the resolved package, and the URL the request would have used.

## 0.5.2

### Patch Changes

- 232b6f5: Apply a provider block's `npm` to every model of that provider, not only to models the same block redeclares. A config that set `npm` together with `options.baseURL` but declared no `models` had its `npm` silently ignored while the `baseURL` was applied, so the catalog's SDK was paired with the configured host — for example the Anthropic `/v1/messages` path sent to an OpenAI-compatible host, which 404s. Omitting `npm` still keeps the catalog package while overriding the host, and a per-model `provider.npm` still wins over the provider-level value.
- e8295f1: Show the provider, model and request URL on provider transport failures.

  A failing provider request used to print only the response body, e.g. `404 Page not found`, which cannot be told apart from a wrong API key, a wrong model id, or a wrong host. The request URL was already recorded on the durable message record but never displayed. It is now shown on both the CLI (`redcode run`, interactive and streaming) and the TUI message panel:

  ```
  404 Page not found
    provider minimax/MiniMax-M3
    request  https://api.minimax.chat/v1/messages
    status   404
  ```

  The resolved provider and model are now recorded on the error itself, so `session.error` events and `--format json` carry them too. Request URLs are redacted before display: userinfo, fragments, and all query values outside a small allowlist are withheld, so an API key embedded in a URL cannot leak. Response headers are never displayed.

- ab85ac4: Prefer `redcode.json` / `redcode.jsonc` for global and project configuration, keeping `opencode.json` / `opencode.jsonc` as a fallback.

  The global config directory is already `~/.config/redcode/`, but the file inside it was still OpenCode-named. Both names are now read everywhere, in every scope. Existing configs keep working with no migration and no warning: when a directory holds both names they are merged exactly the way `opencode.json` and `opencode.jsonc` already merge, with the Redcode-named file winning the fields they share. Directory proximity still outranks the file name, so a nested `opencode.json` beats a `redcode.json` further up.

  Files are never created beside an existing config. A global config or an `opencode mcp add` target is only written under the Redcode name when no config exists at all; otherwise the file already on disk is edited in place.

  The `customize-opencode` skill no longer points the agent at `~/.config/opencode/`, which has not been the config directory since the directory rename.

## 0.5.1

### Patch Changes

- be73f63: Report a rejected `opencode run` prompt exactly once. The request's own error and the `session.error` event the server publishes for it are the same failure on two channels, so the run could print it twice — or emit two `error` records on `--format json` stdout — depending on whether the event subscription attached before the server published. The first reporter now wins and the other stays silent.
- 21b52c2: Add `redcode debug runtime`, which prints the composition the current location actually booted: the active Cordis profile and its ordered plugin IDs, the effective service topology derived from the compiled layer graph, and the runtime invariant report from boot readiness. Runtime invariants now return a typed result per owner instead of passing silently, and a failing owner is named while still failing boot. The payload carries identifiers only — no config values, credentials, paths, or environment.

## 0.5.0

### Minor Changes

- 5d89064: Add a governed RedSkills child Agent contract to `redcode acp`, including parent-bound outcomes and permissions, cancellation-safe multi-turn sessions, and authority isolation from GitHub and redskilled.

## 0.4.0

### Minor Changes

- 7b8733f: Rebuild the Workers view as a live fleet console: capacity meters for slots and memory, a sortable-by-project table with phase bars, heartbeat freshness and token counters, and a detail pane with throughput rates, a token sparkline, and a per-Worker activity feed. Adds enter to expand one Worker, o to open its issue, R to refresh, g/G to jump, and a tab badge that counts failed Workers.

### Patch Changes

- 13afa51: Publish a real npm package page: what Redcode is, how to install it, the commands you can run, and attribution to OpenCode and DeepSeek Harness. The tarball now also carries NOTICE alongside LICENSE.
- c5cda51: Identify the native ACP Agent and its terminal authentication flow as Redcode.

## 0.3.2

### Patch Changes

- e66d0ce: Open Redcode directly in a new full TUI session and use Redcode branding in terminal titles.

## 0.3.1

### Patch Changes

- a0279da: Open Redcode directly in the full chat shell, including for profiles that previously selected the legacy interface.

## 0.3.0

### Minor Changes

- e5c97af: Boot internal plugins through the transactional Cordis profile host and expose an inspectable Location service graph.

## 0.2.0

### Minor Changes

- 32afa3a: Open RedCode directly in a full chat draft, apply the RedCode wordmark and brand palette, and add transactional plugin profile composition with runtime inventory checks.

### Patch Changes

- 1b06d4e: Publish checksums with every native archive and refuse to replace assets on an already published Redcode tag.
- 4a44912: Make npm release reconciliation tolerate registry propagation delays before publishing the GitHub Release.
- 38d25c3: Make Redcode releases recoverable by tag and publish native packages with verifiable repository provenance.
