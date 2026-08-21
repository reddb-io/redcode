---
"opencode": minor
---

Introduce capability seams for filesystem, shell, subprocess and LSP, plus the V2 plugin-context surface to register additional backends. The harness is now composable per-location without touching core: a plugin can install a remote FS, an SSH-backed shell, or a Docker sandbox and consumers keep talking to the same service tag.

- `packages/core/src/capability/{filesystem,shell,process}.ts` and `packages/opencode/src/capability/lsp.ts` define `Interface` (consumer surface), `Backend` (provider shape) and a default `Local` backend that wraps the existing implementation.
- `packages/core/src/capability/registry.ts` exposes `CapabilityRegistry.Service` with per-capability `register(backend): Registration` — plugins install a second backend and `dispose` removes it on scope exit.
- `packages/core/src/capability/shell/ssh.ts` ships a minimal real SSH shell backend (`ShellService.Backend` over ssh2) as the proof that the seam accepts a second provider.
- `packages/plugin/src/v2/effect/{capability,context}.ts` exposes `ctx.capability.{filesystem,shell,process}.register` to V2 plugins.
- `packages/opencode/src/plugin/index.ts` logs a one-line deprecation warning when a V1 plugin loads through the legacy `server()` hook, pointing at the V2 surface.

The full V1→V2 hook translation shim is intentionally out of scope for this release and lands in the next minor; this PR makes the seams available and signals the migration path.
