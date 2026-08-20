# DeepSeek Harness: principle-by-principle adoption plan for Redcode

Date: 2026-08-15
Query: Evaluate the newly released DeepSeek Harness in depth, determine which principles Redcode should adopt, identify what is already active in the shipped runtime, and define the safest path to maximize useful adoption.
Scope: Official `deepseek-ai/deepseek-harness` repository at commit `47f943859bef60e4160492346772ded9b24f765a`; Redcode `v0.3.0` plus the direct-chat correction in this branch. The audit covers boot composition, services, events, persistence, agent and tool lifecycles, permissions, sandboxing, diagnostics, testing, and failure containment.

## Executive Summary

DeepSeek Harness is most valuable to Redcode as an architectural pressure test, not as a replacement runtime. Its strongest idea is that the running system should be a reversible, inspectable composition whose durable facts, live coordination, policy decisions, and externally observed effects remain distinguishable. This idea appears consistently in its Cordis plugin tree, profile patching, capability seams, event taxonomy, tool pipeline, invariant companions, generated catalogs, transactional reload, and post-mortems.

Redcode has already adopted the highest-leverage first layer in `v0.3.0`: Cordis owns the outer lifecycle of real internal `PluginV2` composition; profiles activate in order, await readiness and teardown, roll back on replacement failure, and expose active inventory. Effect remains the typed service/resource kernel. `LayerNode.inspect` derives the effective Location service topology, runtime invariants execute at boot readiness, and a real Location composition test covers the production entry path. SessionV2 already supplies a stronger product-specific durability boundary than a direct transplant of Harness sessions would provide.

The most important remaining opportunity is not “more plugins.” It is one shared, pure description of the effective runtime that boot, diagnostics, reload, tests, and generated documentation all consume. Redcode should next add a read-only, redacted runtime dump; then specify Schema-owned declarative profiles and a deterministic patch algebra with provenance; then add package-owned invariants for model-visible request reconstruction and tool-result adjacency. Tool approval, subprocess, and sandbox paths should be audited as orthogonal state machines that fail closed.

This audit recommends adopting approximately the following conceptual surface:

- Adopt fully: reversible ownership, ordered composition, derived diagnostics, package-owned invariants, semantic tests, durable/model-visible correspondence, fail-closed policy, transactional reload, and orthogonal process outcomes.
- Adapt to Redcode: capability catalogs from `LayerNode` and package exports; tool stages around SessionV2's one-stream-per-turn rule; durable background work with Protocol identities; profile configuration through Effect Schema rather than Harness YAML/JavaScript expressions.
- Do not transplant: replacing Effect, replacing SessionV2, executable `!!js` configuration, unrestricted model-authored plugins, or Harness's package topology as a mechanical target.

## Official Sources

- [Repository and developer-preview notice](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a)
- [Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/architecture.md)
- [Agent lifecycle](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/agent-lifecycle.md)
- [Tool execution pipeline](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/tool-execution-pipeline.md)
- [Capability seams](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/capability-seams.md)
- [Persistence catalog](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/persistence-catalog.md)
- [Runtime invariants](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/subsystems/invariants.md)
- [Approval subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/subsystems/approval.md)
- [Sandbox subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/subsystems/sandbox.md)
- [Testing policy](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/testing.md)
- [Defensive patterns](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/defensive-patterns.md)
- [Application boot and profiles](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/boot/app-boot/README.md)
- [Failure post-mortems](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a/docs/postmortem)

## Hotlinks

- Redcode's accepted boundary: [ADR 0001](../adr/0001-hybrid-cordis-effect-plugin-runtime.md)
- First evaluation: [2026-08-14 report](2026-08-14-deepseek-harness.md)
- Runtime activation audit: [2026-08-14 follow-up](2026-08-14-deepseek-harness-2.md)
- Redcode plugin host: `packages/core/src/plugin/cordis.ts`
- Redcode production plugin boot: `packages/core/src/plugin/internal.ts`
- Redcode invariant registry: `packages/core/src/invariant.ts`
- Redcode effective service graph: `packages/core/src/effect/layer-node.ts` and `packages/core/src/location-services.ts`
- Redcode durable model loop: `packages/core/src/session/runner/llm.ts`
- Redcode durable tool projection: `packages/core/src/session/runner/publish-llm-event.ts`

## Key Findings

### 1. The plugin tree is an operational ownership graph

Harness treats almost every capability as a plugin and uses the tree to define lifetime, dependency availability, event scope, configuration, and cleanup. The transferable principle is not “make every file a plugin”; it is “every installed effect has one reversible owner.” A feature is ready only after its activation settles, and removing or replacing it must await cleanup.

Redcode now implements this at the correct outer boundary. Cordis owns ordered `PluginV2` profile fibers, while Effect owns typed services, Location scoping, child scopes, and resource finalizers. This avoids a second service locator and preserves the repository's dependency direction. The production `internal` profile, rather than only an isolated host test, goes through this boundary.

Remaining gap: profile declarations are currently code-owned. They lack a public Schema, source provenance, a redacted resolved dump, and a transaction shared by file reload and startup.

### 2. Separate durable truth, live coordination, and capability policy

Harness distinguishes durable Session events from in-flight Agent events and capability events. This prevents a live callback or UI notification from accidentally becoming historical truth. Its agent lifecycle also makes turn and step boundaries explicit and requires model-visible state to be recorded.

Redcode's SessionV2 already aligns strongly:

- `SessionV2.prompt` durably admits input before advisory execution wake-up.
- Session execution is process-global and Session-ID based, while runner/model/tools remain Location-scoped.
- projected history is reloaded before durable continuation;
- each provider turn has one explicit `llm.stream(request)` call;
- steering, queueing, retry reconciliation, and interruption have explicit semantics.

The next adoption should therefore strengthen correspondence around SessionV2, not replace it: persist or reconstruct every model-visible request header (model selection, system-context epoch, tools, relevant policy), and add an owner-level invariant that compares the durable/projection sources with the actual request boundary.

### 3. Capability seams should be discoverable from code

Harness documents Definition, Provider, and Consumer roles and generates catalogs and graphs from package metadata and imports. This makes missing providers, accidental dependencies, and undocumented seams visible before runtime.

Redcode has the raw material in `LayerNode`: service tags, dependencies, replacements, and compiled group order. `LayerNode.inspect` and `LocationServiceMap.serviceInventory` are the correct first step. The remaining work is a generator that combines this graph with package/export ownership and reports:

- service definition package;
- production provider node;
- direct consumers;
- scope tag (global, Location, Session where applicable);
- legal replacement points;
- invariant owner;
- Protocol exposure, if any.

This output should be generated and checked for drift; runtime code should continue importing typed services rather than looking them up in the catalog.

### 4. Tool execution is an ordered policy pipeline

Harness's tool path is explicit: pre-processing waterfall, monotonic guards, approval, around-execution middleware, tool body, tool-owned events, post-processing, definition-owned finalization, immutable observation, and one durable tool result. Parallel tool calls may execute concurrently, but their durable/model-facing ordering follows the model result order. Call/result adjacency is treated as a semantic property.

Redcode already rejects a result before its call and duplicate results in `publish-llm-event.ts`, and the SessionV2 runner reloads projected history before continuing after local tool settlements. That is a sound foundation. The gap is a documented whole-path audit across registry, permission, execution, publication, cancellation, and provider-executed tools.

Adoption rule: policy may only become more restrictive as a call advances. A later hook must not undo a path restriction, permission denial, sandbox requirement, or cancellation. Exactly one normalized, durable result should cross back into model history.

### 5. Approval and sandbox are fail-closed state machines

Harness gives approval explicit outcomes such as allowed once, rejected, cancelled, and unavailable. Only the positive outcome grants execution; a missing or throwing answerer does not. It records both the request and decision. Sandbox resolution is per call, reports full versus partial enforcement, distinguishes policy denial from runner/backend failure, and fails closed when required enforcement is unavailable.

Redcode should apply these rules to `PermissionV2`, workflow-tool approval, external-directory approval, Bash, subprocesses, and future sandbox backends. The core result model should keep these dimensions separate:

- child process exit/signal;
- policy denial;
- approval outcome;
- sandbox enforcement level;
- sandbox runner/backend failure;
- timeout/cancellation;
- user-visible notice.

Collapsing these into one success boolean creates the class of bug documented in Harness's Landlock post-mortem.

### 6. Configuration needs one pure composition function

Harness profiles are ordered bundle layers plus profile and user patches. The same parser and patch algorithm feed boot and config dumps. Long-running surfaces watch patch files; candidate changes are serialized, validated, and transactionally applied, while the last good tree survives a failed reload. Dumps include source/layer provenance and unmatched-patch warnings.

Redcode should adopt the algebra but not the syntax. The target is an Effect Schema-owned value with stable row IDs and no executable expressions. One pure resolver must power:

- startup;
- `runtime inspect` or equivalent diagnostics;
- candidate validation;
- reload;
- golden fixtures;
- generated documentation.

Secrets should remain references, never resolved values in dumps. File watching comes only after the pure resolver and rollback tests exist.

### 7. Tests must prove semantic outcomes through real entry points

Harness explicitly treats coverage as insufficient. Its policy favors real implementations, controls only nondeterminism, checks the external world instead of an agent's self-report, tests published artifacts, and combines snapshots with semantic impossibility guards. Lifecycle/HMR tests verify teardown and quiescence.

Its post-mortems make this concrete:

- a default export lost Cordis injection while unit tests and coverage stayed green; a real Loader entry test exposed it;
- an expression-shaped disabled flag remained truthy and snapshots accepted `UNKNOWN_TOOL`; a static guard and semantic snapshot check were needed;
- a web test talked to the wrong replacement server; the current URL/mode needed to be model-visible and externally verified;
- partial Landlock enforcement was confused with child failure because independent outcomes were not modeled independently.

Redcode has already applied this lesson to runtime boot and direct-chat entry. The current UI E2E starts from an explicitly persisted legacy preference and proves the browser reaches a draft route, shows the Redcode shell and composer, omits the legacy OpenCode mark, and makes no empty Session POST.

### 8. Defensive cleanup is part of correctness

Harness's defensive patterns are especially applicable to an agent runtime: process outcomes remain orthogonal; public contracts are normalized at both boundaries; asynchronous state changes are not treated as causal completion; disposal must reach quiescence; observer/callback exceptions are contained; child environments are scrubbed; temporary paths are private and randomized; symlinks and junctions are removed without following them recursively.

Redcode should turn these into review and test criteria for `AppProcess`, background jobs, watchers, tool cancellation, shell execution, workspace mutation, and future profile reload. Effect scopes help, but they do not by themselves prove that callbacks stopped producing effects after disposal.

## Adoption Matrix

| Principle | Redcode status | Decision | Next evidence |
|---|---|---|---|
| Reversible plugin ownership | Adopted in `v0.3.0` | Keep hybrid Cordis/Effect boundary | Production profile lifecycle tests |
| Ordered, awaited profile activation | Adopted | Keep startup failure loud | Startup timing and failure tests |
| Transactional profile replacement | Adopted in memory | Extend only after Schema design | Candidate file reload preserves last good tree |
| Active plugin inventory | Adopted | Expose read-only and redacted | CLI/API snapshot from live runtime |
| Derived service topology | Adopted internally | Generate ownership/capability catalog | Drift-checking generator |
| Package-owned runtime invariants | Foundation adopted | Add authoritative semantic checks | Request reconstruction and capability completeness |
| Durable versus live events | Strongly aligned through SessionV2 | Preserve Redcode vocabulary | Explicit event ownership documentation |
| Model-visible means durable/reconstructable | Partial | Adopt | Request-header reconstruction invariant |
| Ordered tool policy pipeline | Partial | Audit, then formalize | Call/result adjacency and monotonic-policy tests |
| Fail-closed approval | Partial | Adopt across every execution path | Unavailable/throwing answerer tests |
| Per-call sandbox facts | Partial | Adopt when backend is present | Full/partial/unavailable result matrix |
| Pure config composition shared by boot/dump/reload | Not yet | Highest-priority design | Schema + resolver property tests |
| Transactional config HMR | Not yet | Adopt after resolver | Serialized reload and quiescent teardown tests |
| Definition/provider/consumer generated graph | Partial | Adapt from `LayerNode` | Checked-in generated catalog |
| Real-entry and artifact smoke tests | Partial | Expand | Packed CLI/install and desktop/web startup smokes |
| Durable typed jobs/goals/subagents | Partial foundations | Design through Protocol first | Identity, recovery, cancel, placement semantics |
| Dynamic model-authored extensions | Not adopted | Defer | Provenance, permission, sandbox and rollback spec |
| Executable YAML/`!!js` config | Not adopted | Reject | Schema data only |
| Replace Effect or SessionV2 | Not adopted | Reject | N/A |

## API, CLI, and Config Details

Harness identifies itself as a developer preview and documents `npx @deepseek-ai/dsh web` as its direct launch surface. The root workspace is `0.1.0-rc.5`, requires Node `^22.19.0 || >=24.0.0`, and uses pnpm `11.7.0` at the audited commit.

Its application boot package exposes a useful contract surface:

- `boot(...)` mounts the root include, awaits Loader settlement and enabled-entry activation, and disposes a partially started context on failure;
- `assertEntriesLoaded` and `assertEntriesActivated` distinguish unresolved, failed, and pending plugins;
- `renderConfigDump(...)` runs the same parser and patch algorithm as boot and annotates layer provenance;
- `watchUserPatches(...)` serializes reconfiguration and preserves the last good tree on candidate failure;
- layered environment loading gives inherited values precedence over project `.env`, then Harness-home `.env`, while rejecting bootstrap-only variables from files.

Profiles live under `$DSH_HOME/profiles/<name>` (or `~/.dsh` by default). Their manifests declare an ordered bundle list. Bundle patches are followed by profile and home-level user patches. A row-targeted patch replaces the whole matched config rather than deep-merging it; unmatched targets warn. Harness permits `!!js` expressions during mount. That last feature should not cross into Redcode.

Proposed Redcode diagnostic shape, subject to a dedicated Protocol/CLI design:

```text
redcode runtime inspect [--location <path>] [--format toon|text]
  profile: stable profile ID and ordered plugin IDs
  services: service ID, scope, provider, dependencies, replacement provenance
  invariants: owner, name, last boot result
  config: redacted resolved values plus source labels
```

The first version should be read-only and local. It should derive data from the actual `PluginV2` inventory and `LayerNode.inspect`; it must not become a second registry or expose credentials.

## Recommended Next Steps

### Phase 0 — completed or in this branch

1. Keep the shipped `v0.3.0` hybrid Cordis/Effect runtime and production `internal` profile.
2. Keep runtime invariants in the boot readiness boundary and service topology derived from `LayerNode`.
3. Retire the legacy UI path for Redcode so empty and previously legacy profiles both enter the full chat shell without a transient OpenCode splash.
4. Keep the Redcode wordmark and palette at the top-level shell, validated through the real browser entry path.

### Phase 1 — next high-value slice

1. Add a read-only runtime inspection service/command over the existing active plugin and service inventories.
2. Redact at the producer boundary and support text plus TOON rendering at the CLI boundary.
3. Generate a capability catalog from `LayerNode` plus package/export ownership and check it for drift in CI.
4. Add invariants for missing production providers, duplicate capability ownership, and illegal runtime dependency direction where the source of truth is authoritative.

### Phase 2 — declarative composition

1. Define the profile, row, patch, source-provenance, and secret-reference Schemas.
2. Implement one synchronous pure resolver with stable IDs and deterministic ordering.
3. Use the resolver for inspect output and fixtures before using it for boot.
4. Add transactional candidate activation with serialized changes, rollback, watcher cleanup, and quiescence tests.
5. Do not support executable configuration expressions.

### Phase 3 — execution integrity

1. Map the full Redcode tool path from model call through permission, sandbox, execution, publication, projection, and next-turn reconstruction.
2. Make policy restrictions monotonic and approval unavailable/error outcomes fail closed.
3. Assert exactly one durable terminal result per admitted tool call and preserve model-order adjacency under parallel execution.
4. Persist or deterministically reconstruct the model-visible request header and add a Session-owned invariant.
5. Model subprocess, sandbox, policy, cancellation, and user notice outcomes independently.

### Phase 4 — durable orchestration

1. Specify background job, goal, workflow, and subagent identities in Protocol before adding dynamic orchestration.
2. Define ownership, placement, cancellation, result delivery, restart recovery, and transcript boundaries.
3. Reuse SessionV2 durable admission and Location placement rules; do not hide orchestration in an in-memory tool loop.

## Gotchas

- Harness is explicitly unstable. Copying its internal APIs would couple Redcode to developer-preview churn; adopt invariants and observable contracts instead.
- Redcode uses the published Cordis package, while Harness vendors and hardens its own framework. Redcode may rely only on lifecycle behavior covered by its tests.
- A configuration dump is a potential secret leak. Redaction must happen before serialization, logs, snapshots, or error messages.
- Generated diagrams become misleading if their source is a handwritten manifest. They must be derived from executable structure and checked for drift.
- Runtime invariants must compare authoritative facts. Checking only that a service exists is a smoke test, not an architectural invariant.
- HMR is a concurrency feature, not a file-watcher feature. Candidate validation, serialized mutation, atomic visibility, rollback, observer isolation, and teardown all need tests.
- “100% coverage” can coexist with a broken boot graph or semantically impossible snapshot. Real entry paths and negative semantic guards remain necessary.
- Dynamic extensions increase the attack surface across code loading, configuration, filesystem, credentials, and model instructions. They should remain disabled until the full trust model exists.
- A sandbox can be partially enforced. Reporting a notice must not overwrite or misclassify the child process result.

## Open Questions

1. Should runtime inspection be a Core service consumed by both CLI and Server, or a CLI-only composition over Core data? The dependency direction favors typed Core data with serialization at the outer boundary.
2. Which request-header facts are already durably reconstructable from SessionV2 projection and Context Epoch, and which require new persistence?
3. Are provider-executed tools subject to the same approval and durable-result invariants as locally executed tools, or do they need a separate explicitly named branch?
4. What is the minimum sandbox enforcement vocabulary that works consistently across Linux, macOS, Windows, and remote workspace runners?
5. Should declarative profiles be user-editable in the first release, or initially generated/read-only while the patch algebra stabilizes?
6. Which package metadata can authoritatively identify Definition, Provider, and Consumer roles without introducing circular runtime dependencies?

## Source-by-Source Notes

### Architecture and lifecycle

`docs/architecture.md` describes the Harness as an ordered plugin composition with distinct event domains, a durable session log, and extension seams. `docs/agent-lifecycle.md` makes turn/step/inbox boundaries explicit and ties successful model requests and tool interactions to the session record. These sources support the reversible-ownership and durable/model-visible recommendations.

### Tool, approval, and sandbox

`docs/tool-execution-pipeline.md` defines ordered pre/guard/approval/around/body/post/finalization/observation stages and one durable result. The approval and sandbox subsystem documents provide the fail-closed and per-call enforcement contracts. These sources support an audit of Redcode's permission, Bash, workflow-tool, and provider-executed branches before adding new hooks.

### Invariants and capability seams

`docs/subsystems/invariants.md` places checks with owning packages while a registry owns selection and lifecycle. `docs/capability-seams.md` explains generated Definition/Provider/Consumer views. Redcode's `RuntimeInvariant` and `LayerNode.inspect` align with this direction but do not yet provide the generated ownership catalog or deeper authoritative checks.

### Boot and configuration

`packages/boot/app-boot/README.md` documents layered environment sources, ordered profiles, full-config replacement patches, shared boot/dump composition, transactional patch HMR, activation audits, and failure cleanup. Redcode should reproduce those behavioral properties with Effect Schema data and without executable expressions.

### Testing, defense, and post-mortems

`docs/testing.md` and `docs/defensive-patterns.md` prioritize real behavior, external ground truth, lifecycle cleanup, contract normalization, secret scrubbing, and orthogonal results. The four official post-mortems demonstrate escaped failures involving a lost dependency injection declaration, truthy executable config metadata, GUI verification against the wrong server, and conflated sandbox/process outcomes. They directly motivate Redcode's real-entry tests, semantic guards, and explicit outcome modeling.

## Version Notes

- The official `master` branch resolved to `47f943859bef60e4160492346772ded9b24f765a` when rechecked on 2026-08-15.
- No release tags were present in the official remote at the time of the audit.
- The root workspace version at that commit is `0.1.0-rc.5` and the README labels the project a Developer Preview with breaking changes expected.
- Redcode `v0.3.0` contains the first runtime adoption wave. The direct-chat migration correction in this branch requires a new `opencode` changeset; release versions remain owned by the Version PR.
