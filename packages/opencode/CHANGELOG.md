# opencode

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
