# DeepSeek Harness: runtime adoption audit for RedCode

Date: 2026-08-14
Query: Revisit the DeepSeek Harness evaluation, verify which principles are active in RedCode's shipped runtime, and close the safest high-value gaps.
Scope: Official Harness repository at commit `47f943859bef60e4160492346772ded9b24f765a`; RedCode's real Location and internal-plugin boot path; composition, inspection, lifecycle, invariants, session durability, tool policy, and testing. This supplements rather than replaces `2026-08-14-deepseek-harness.md`.

## Executive Summary

The first RedCode adoption wave captured the right architecture but left one consequential implementation gap: `CordisPluginHost` was covered by isolated tests while the production internal-plugin boot still called `PluginV2.add` directly in a forked Effect. That meant the shipped runtime did not receive the profile ownership, ordered activation, awaited readiness, transactional rollback, or active-profile diagnostics described by the ADR.

This audit closes that gap. Internal plugins are now one named `internal` profile applied through the Cordis host. Boot awaits activation, then runs the Location-scoped invariant registry. A typed `LayerNode.inspect` projection exposes the effective Location service graph, including replacements and dependency order, without introducing a second handwritten inventory. A real Location composition test proves the shipping boot path activates exactly the declared built-ins and that its invariants pass.

The result adopts the highest-leverage Harness principles without importing its product topology: reversible ownership, inspectable composition, ordered activation, runtime architectural checks, and real-entry-path testing. Effect remains RedCode's service/resource kernel, and SessionV2 remains the durable execution authority.

## Official Sources

- [DeepSeek Harness repository](https://github.com/deepseek-ai/deepseek-harness) — official repository and developer-preview status.
- [Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/architecture.md) — plugin tree, ordered profiles, event domains, session log, and extension points.
- [Capability seams](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/capability-seams.md) — generated definition/provider/consumer inventory.
- [Tool execution pipeline](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/tool-execution-pipeline.md) — layered policy, monotonic guards, finalization, and durable tool outcomes.
- [Runtime invariants](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/subsystems/invariants.md) — package-owned checks, scoped registration, attribution, and lifecycle.
- [Testing policy](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/testing.md) — real composition, external ground truth, semantic assertions, and lifecycle cleanup tests.
- [Persistence catalog](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/persistence-catalog.md) — durable versus projection-producing events.
- [Vendored lifecycle hardening](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/vendor/README.md) — transactional reconciliation, serialized mutation, rollback, and configuration diagnostics.
- [Post-mortems](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/postmortem/README.md) — process guardrails derived from escaped failures.

## Implementation Coverage Audit

| Harness principle | Before this audit | After this audit | Evidence / boundary |
|---|---|---|---|
| Every extension has a reversible owner | PluginV2 effects had Effect scopes; Cordis ownership existed only in isolated host use | Internal production plugins are mounted by Cordis fibers that await Effect teardown | `packages/core/src/plugin/internal.ts`, `packages/core/src/plugin/cordis.ts` |
| Boot is an ordered, named composition | Built-ins were an imperative sequence of direct `add` calls | Built-ins form the ordered `internal` profile | `PluginInternal.builtInIDs` and live Location test |
| “Ready” means activation settled | Internal boot was forked in the background | The Location layer awaits profile application before boot succeeds | `PluginInternal.boot` span |
| Failed composition restores the prior tree | Host rollback existed but did not protect internal boot | Production composition uses that transaction boundary | Cordis host rollback tests plus real boot test |
| Running architecture is inspectable | Plugin IDs were listable; service topology remained compile-only | `LayerNode.inspect` derives effective service nodes, dependencies, tags, and replacements | `LocationServiceMap.serviceInventory` |
| Architectural checks belong to the owner | Registry and PluginV2 check existed | Boot now executes registered invariants after the profile settles | `RuntimeInvariant.Service.run` in internal boot |
| Test the real entry path | Host tests used a test layer | A temporary Location boots all real internal plugins and checks exact inventory | `packages/core/test/location-layer.test.ts` |
| Durable facts differ from live hooks | Already present in SessionV2 design | Preserved unchanged | Durable admission, exact retries, delivery modes, and Location-scoped runner remain authoritative |

## Findings and Decisions

### 1. Composition abstractions must protect the production path

An unused host is not an adopted architecture. The decisive test is whether the normal Location boot can bypass the ownership and transaction boundary. RedCode could; now it cannot for internal plugins. The profile declaration is also the inventory used by the test, so adding a built-in changes the expected production composition automatically.

### 2. Inspection should be derived from executable structure

Harness generates capability and Cordis catalogs from its source. RedCode's closest source of truth is `LayerNode`, which already encodes service identities, tags, dependencies, and legal replacements. `LayerNode.inspect` walks the effective graph with the same replacement semantics as compilation and returns typed data. This is safer than maintaining a parallel diagram or JSON manifest by hand.

The next increment can render this data as TOON or human-readable text in a diagnostics command. Serialization belongs at that boundary; the Core graph API should remain typed data.

### 3. Invariants are useful only at a meaningful boundary

Registration alone does not protect boot. Running checks after profile activation turns inventory consistency into a readiness condition: an invalid runtime cannot silently advertise itself as ready. RedCode's smaller registry intentionally differs from Harness's configurable package filters; allow/block configuration is not needed until production diagnostics demonstrate a cost or compatibility reason.

### 4. Harness's tool pipeline is a design checklist, not drop-in code

The official pipeline separates pre-policy, monotonic owner guards, around-dispatch behavior, post-processing, definition-owned finalization, immutable observation, and the single durable model-facing result. RedCode should audit its existing tool path against that ordering before adding hooks. It should not graft event stages onto SessionV2 without proving that every model-visible result remains durable and replayable.

### 5. Tests must assert semantic success

Harness's filesystem-tool post-mortem is directly applicable: snapshots can faithfully record a broken composition. RedCode's direct-chat e2e therefore asserts the actual draft route, visible composer, absence of persistent session writes, the `redcode` accessible wordmark, and absence of the legacy OpenCode mark. The new runtime test asserts exact active plugin IDs rather than merely observing that boot did not throw.

## Adoption Matrix

### Adopted now

- Direct-to-chat draft entry, with the old splash/mini-input step removed from the default route.
- RedCode wordmark and brand palette in the top-level shell.
- Cordis as the outer reversible owner of real internal PluginV2 composition.
- Ordered named profile activation with serialized replacement, awaited teardown, and rollback.
- Stable active plugin inventory.
- Package-owned, scoped runtime invariants executed as part of boot readiness.
- Derived inspection of the effective Location service dependency graph.
- Real-composition and lifecycle tests in addition to isolated host tests.
- Existing SessionV2 separation of durable prompt admission from model execution.

### Adopt after a dedicated design

- Schema-owned declarative profiles with stable row IDs, provenance, redaction, and one pure patch resolver shared by boot, inspection, reload, and tests.
- A `dump-config`/architecture command rendered from typed inventories, preferably TOON for machine-consumed structured output.
- Transactional file reload using candidate validation, a serialized mutation queue, atomic commit, rollback, and watcher teardown tests.
- A generated definition/provider/consumer capability catalog backed by package metadata and `LayerNode` edges.
- More owner-specific invariants, especially model-visible-input reconstructability and capability completeness.
- A formal tool-pipeline audit covering policy ordering, immutable final outcomes, cancellation, and durable result adjacency.

### Do not transplant

- Replacing Effect layers with Cordis services: this would duplicate RedCode's dependency kernel and weaken compile-time service requirements.
- Replacing SessionV2 with Harness's session implementation: RedCode's durable inbox admission, retry reconciliation, delivery vocabulary, and serialized coordinator are product invariants.
- Dynamic model-authored plugins before provenance, permissions, signature, persistence, and rollback semantics exist.
- Background jobs or goals without durable Protocol identity, recovery, cancellation, and placement semantics.
- Harness YAML or JavaScript-expression configuration verbatim. RedCode needs Schema ownership and must avoid executable configuration crossing trust boundaries.

## Risks and Gotchas

- Awaiting internal profile activation changes readiness timing intentionally. Startup regressions should be measured, but returning before required plugins settle would violate the adopted lifecycle contract.
- RedCode uses published `@deepseek-ai/cordis`, while Harness vendors and hardens its framework. Only behavior covered by RedCode tests should be relied upon.
- An inventory is diagnostic evidence, not an authorization surface. Runtime code must continue to depend on typed services and Protocol contracts.
- Graph inspection may contain repeated names when intentionally distinct branch-local implementations share identity; a future renderer must preserve enough provenance to avoid false deduplication.
- A successful snapshot is not semantic proof. Tests must also assert required tools, routes, durable records, or externally observed state.

## Recommended Next Steps

1. Land the runtime boot integration and graph inspection in this change.
2. Add a read-only diagnostics surface that renders the active plugin profile and Location service inventory without secrets.
3. Specify the profile Schema and pure patch algebra before adding files or HMR.
4. Audit tool execution ordering and durable results against the official Harness pipeline.
5. Add SessionV2-owned reconstructability invariants only where authoritative durable and projected data can be compared without new cross-package dependencies.

## Version Notes

- The official repository was rechecked on 2026-08-14; `master` still resolved to `47f943859bef60e4160492346772ded9b24f765a`, the same commit used by the original report.
- Harness is explicitly a developer preview and expects breaking changes. Principles are adopted behind RedCode-owned contracts rather than treated as upstream API stability promises.
- RedCode is on release version `0.2.0` before the changes in this supplemental audit; the repository's Version PR remains the only writer of future release numbers.
