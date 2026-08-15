# DeepSeek Harness: architectural adoption for RedCode

Date: 2026-08-14
Query: Evaluate `deepseek-ai/deepseek-harness` in depth and adopt as many useful principles as possible in RedCode.
Scope: Official repository, architecture, capability seams, Cordis composition, profile/patch behavior, lifecycle hardening, durable session principles, and the changes that can be safely introduced without violating RedCode's SessionV2 and dependency-direction invariants. Provider-specific behavior and wholesale session-storage replacement are excluded.

## Executive Summary

DeepSeek Harness is most valuable as a composition architecture, not as code to transplant wholesale. Its strongest ideas are: every extension owns reversible registrations; the running system is reconstructable from an ordered profile; capabilities have explicit definition/provider/consumer seams; durable facts are separated from live interception; package-owned invariants make architectural rules executable; and failed live reconfiguration is transactional.

RedCode already has a strong Effect service graph, Location-scoped services, durable SessionV2 admission, and explicit runtime dependency boundaries. Replacing these with Cordis would lose useful guarantees. The adopted design is therefore hybrid: Effect remains the application and resource-lifetime kernel, while Cordis is introduced only as the reversible composition host for PluginV2 profiles. Cordis fibers mount Effect-scoped plugins, await their cleanup, expose a stable plugin inventory, dump the active composition, and restore the previous profile after a failed replacement.

The first implementation wave also adds a package-owned runtime invariant registry. PluginV2 registers an inventory invariant against it. This creates the same architectural feedback loop as Harness without coupling unrelated packages to a central validator.

The following ideas should be adopted incrementally: declarative profile files and ordered patch overlays; a generated capability inventory; transactional config reload; and background jobs/goals only after their durable Protocol and SessionV2 semantics are designed. The Harness append-only session model should inform RedCode's projections, but RedCode must preserve its existing durable prompt admission and serialized drain rules rather than replacing them.

## Official Sources

- [DeepSeek Harness repository](https://github.com/deepseek-ai/deepseek-harness) — official source repository and project status.
- [Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/architecture.md) — official architectural vocabulary, profile layering, event domains, session log, and extension map at the reviewed commit.
- [Cordis primer](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/cordis-primer.md) — official explanation of contexts, plugins, services, events, effects, and disposal.
- [Capability seams](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/capability-seams.md) — generated official definition/provider/consumer graph.
- [Agent lifecycle](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/agent-lifecycle.md) — official turn/step/event flow.
- [Vendored packages](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/vendor/README.md) — official pinned Cordis inventory and exhaustive lifecycle/config hardening log.
- [DeepSeek Harness paper](https://arxiv.org/abs/2604.14302) — primary design and evaluation paper linked by the project.

## Hotlinks

- [Profiles and bundles](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/architecture.md#profiles-and-bundles) — ordered composition and patch precedence.
- [Session log](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/architecture.md#session-log) — reconstruction and the “model-visible means logged” rule.
- [Where new behavior goes](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/architecture.md#where-new-behavior-goes) — authoritative extension-point map.
- [Vendored local modifications](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/vendor/README.md#local-modifications) — transactional reload, reentrant disposal, HMR serialization, and cleanup durability.

## Key Findings

### 1. Spatial and temporal composition are equally important

Harness uses Cordis plugins for spatial composition (which services and capabilities exist) and reversible effects for temporal composition (what must be undone when a plugin unloads). The important property is not “everything is a package”; it is that every registration has an owner and a deterministic cleanup boundary.

RedCode mapping: keep Effect layers/services as the dependency graph and use a Cordis fiber to own each PluginV2 mount. Plugin effects still execute inside child Effect scopes. Disposal awaits `PluginV2.remove`, so a composition change cannot report completion while resources from the previous profile remain alive.

### 2. Runtime composition should be reconstructable

Harness boots from ordered bundle/profile/home/CLI patch layers and can dump the effective tree. A user can inspect what actually ran instead of inferring it from scattered startup code.

RedCode mapping: the new host exposes an ordered PluginV2 inventory plus a profile snapshot/dump. Declarative YAML, named bundles, and patch overlays should come next, after a Schema-owned public representation is designed. Reimplementing Harness's patch algorithm ad hoc would be a mistake; RedCode should define one pure resolver and use it for boot, dump, reload, and tests.

### 3. Capability seams need all three roles

Harness defines a seam as a service definition, one or more providers, and consumers. Its generated graph makes missing providers, direct cross-boundary imports, and accidental privileged implementations visible.

RedCode mapping: preserve the repository's Schema → Core/Protocol → Server direction and add inventory generation around existing Location nodes. Cordis must not become a service locator that bypasses this direction. The composition layer consumes the public PluginV2 interface only.

### 4. Durable facts and live extension points are different domains

Harness separates append-only session facts from live agent/capability events. Its critical rule is that model-visible input must be reconstructable from the durable log.

RedCode mapping: this validates the existing SessionV2 split between durable prompt admission and live execution. The Harness design should strengthen projections and runtime invariants, but must not replace `session_input`, exact-retry reconciliation, steering/queue semantics, or process-local drains. New model-visible context still requires a durable SessionV2 design.

### 5. Hot reload is a transaction, not a file watcher

The vendored hardening log is unusually instructive. Candidate config is imported before disposal, lifecycle settlement is awaited, sibling starts are contained, failed updates roll back, tree mutations are serialized, writes are drained at teardown, and watcher aliases are normalized. These changes document real failure modes: stranded registrations, interleaved rollback, deadlock, lost persistence, and false readiness.

RedCode mapping: profile application is serialized and transactional from the first implementation. HMR is intentionally not enabled yet. When added, it must reuse the same resolver and transaction, never mutate the live graph directly from a watcher callback.

### 6. Invariants belong to the package that knows the rule

Harness exposes an invariant registry and lets packages contribute checks. This avoids a central package importing every subsystem merely to validate it.

RedCode mapping: `RuntimeInvariant` is a Location-scoped registry with scoped ownership. PluginV2 registers its own order/active-set consistency check. Future SessionV2 “model-visible means durable” and capability completeness checks can attach through the same seam without reversing dependencies.

## API / CLI / Config Details

Implemented API surface:

- `PluginV2.Interface.list(): Effect<readonly PluginV2.ID[]>` returns active plugins in stable composition order.
- `CordisPluginHost.make(plugins)` creates a scoped hybrid composition host.
- `apply({ name, entries })` atomically replaces a profile and restores the prior one if any candidate fails.
- `clear` awaits complete profile teardown.
- `snapshot` returns the active profile name and ordered IDs.
- `dump` emits a deterministic JSON representation suitable for diagnostics.
- `RuntimeInvariant.Interface.register(owner, check)` owns a check for the caller's scope.
- `RuntimeInvariant.Interface.run` executes the active checks.
- `RuntimeInvariant.Interface.list` reports their owners.

Recommended future configuration order:

1. Base bundle rows.
2. Product bundle rows.
3. Named profile overrides.
4. User/home overrides.
5. One ephemeral CLI or test overlay.

Each row needs a stable ID. A patch should replace a row's complete config or insert a new row. Disablement should be explicit. The resolved list must be inspectable without booting plugins.

## Version Notes

- The repository was reviewed at commit `47f943859bef60e4160492346772ded9b24f765a` to make all architectural claims reproducible.
- At that commit, Harness's vendor manifest records a customized `@deepseek-ai/cordis` snapshot based on upstream `4.0.0-rc.7` and lists the exact upstream commit plus local divergences.
- RedCode installs the published `@deepseek-ai/cordis` package at exact version `4.0.1`. The npm package and Harness's pinned vendored snapshot are not assumed to contain identical lifecycle hardening. RedCode therefore tests the subset it relies on: ordered mount, awaited disposal, replacement, and rollback.
- Harness describes itself as an early/developer-preview system. Its architecture is useful evidence; its current package topology is not automatically a stable compatibility contract for RedCode.

## Gotchas

- Do not make Cordis the owner of Effect services. The boundary must remain Cordis fiber → PluginV2 public interface → Effect child scope.
- Do not expose plugin callbacks to dynamic model-authored code until provenance, permissions, signatures, persistence, and rollback have a threat model.
- Do not add YAML/HMR before one pure resolution function exists. Boot, dump, live reload, and tests must share it.
- A stable row ID is part of the user-facing configuration contract. Renaming IDs needs migration behavior.
- Successful profile application must mean prior cleanup and candidate activation both settled. Scheduling cleanup is insufficient.
- The npm release-age exception is intentionally narrow to the two new DeepSeek-scoped runtime packages; it must not weaken the repository-wide supply-chain delay.
- A generated capability graph can reveal architecture but should never become a handwritten second source of truth.

## Open Questions

- Which configuration package should own the future profile Schema without violating Client/Core/Server dependency direction?
- Should profiles be Location-scoped only, or can a future Workspace identity select a profile?
- Which runtime invariants are safe in production, and which should run only in diagnostics/tests?
- What is the durable identity and recovery model for background jobs before `ctx.jobs`-like behavior is introduced?
- Should profile dumps include plugin options after secrets are redacted, or only IDs and provenance?
- Will RedCode vendor Cordis if it needs Harness-specific lifecycle patches, or keep a narrow tested contract against the published package?

## Source-by-Source Notes

### Architecture

The architecture document establishes the shared vocabulary: plugin tree, profile, bundle, patch row, durable session event, live agent event, capability event, seam, step, and turn. Its strongest operational contribution is the extension-point table, which makes it clear that new behavior belongs beside the loop when a seam exists, not inside the loop by default.

### Cordis primer

The primer explains why Cordis is a suitable outer composition owner: contexts inherit services, plugin effects are collected by fibers, and unload reverses owned effects. RedCode uses only this lifecycle contract and avoids duplicating its service model.

### Capability seams

The generated graph demonstrates how a large harness can remain replaceable while retaining named ownership. It also shows that jobs, goals, filesystem, shell, sandbox, LSP, web access, and session persistence are independent seams, not branches inside one orchestration class.

### Vendored packages

The vendor log is evidence that the elegant high-level model needs substantial low-level hardening. Reentrant unload, pending dependency activation, failed candidate import, concurrent tree mutation, watcher path identity, and durable writes all required explicit treatment. RedCode should adopt the transaction semantics, not assume a watcher plus `dispose()` is enough.

### Paper

The paper positions Harness as an environment optimized jointly with agent models and argues for a modular, extensible harness. For RedCode, the repository's executable architecture and tests are more actionable than model-specific evaluation results; provider-specific optimizations are outside this adoption scope.

## Recommended Next Steps

1. Land the hybrid Cordis/Effect profile host, stable inventory, runtime invariant registry, and direct-to-chat RedCode shell in this change.
2. Define a Schema-owned declarative profile format with stable row IDs, source provenance, secret redaction, and one pure ordered patch resolver.
3. Add `dump-config`/diagnostic exposure and generate a capability inventory from Location node metadata.
4. Add transactional file reload only after boot and dump consume the same resolver; test invalid candidates, teardown failures, concurrent changes, and rollback.
5. Design jobs/goals as separate durable Protocol work. Preserve SessionV2 prompt admission, delivery vocabulary, exact retry, and process-local coordinator constraints.
6. Add package-owned invariants gradually, beginning with plugin inventory and later testing reconstructability of all model-visible SessionV2 inputs.
