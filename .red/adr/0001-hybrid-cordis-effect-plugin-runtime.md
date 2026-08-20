# ADR 0001: Use Cordis as a reversible PluginV2 composition host

Status: Accepted
Date: 2026-08-14

## Context

RedCode needs runtime composition that is inspectable, reversible, and safe to reconfigure. DeepSeek Harness demonstrates an effective model based on Cordis plugin trees, ordered profiles, owned effects, and transactional configuration. RedCode already has Effect layers, Location-scoped services, and documented runtime dependency direction. Replacing that kernel would create a parallel service model and weaken existing SessionV2 invariants.

## Decision

Use a hybrid boundary:

- Effect remains the owner of application services, Location scoping, plugin child scopes, and resource cleanup.
- Cordis owns only the outer PluginV2 composition fibers.
- A Cordis fiber mounts through the public `PluginV2.Interface` and returns an awaited disposer.
- Named profiles are ordered and replace atomically. Failed replacement restores the previous profile.
- PluginV2 exposes a stable active inventory for diagnostics and composition dumps.
- Packages register their own executable checks through a scoped `RuntimeInvariant` service.
- Future declarative profiles and patches must resolve through one Schema-owned pure function shared by boot, dump, reload, and tests.

## Boundaries

- Cordis does not become a general service locator.
- Client runtime code does not import Core or Cordis.
- Dynamic model-authored plugins are not enabled.
- HMR and YAML profile loading are not enabled until transactional resolution, provenance, redaction, and rollback are specified.
- SessionV2 durable admission, delivery semantics, exact retries, and process-local execution coordination remain authoritative.

## Consequences

Plugin profile changes now have deterministic ownership, teardown, ordering, inventory, and rollback. RedCode can adopt more Harness-style composition without a high-risk runtime rewrite. The tradeoff is a deliberately small adapter layer and an exact runtime dependency on `@deepseek-ai/cordis` whose relied-on lifecycle contract must remain covered by tests.

## Validation

- Stable inventory across replacement.
- Awaited teardown when profiles change.
- Restoration of the previous profile when candidate activation fails.
- Scoped invariant registration and removal.
- Real Location boot activates the declared internal profile through Cordis and passes its runtime invariants.
- Effective Location service topology is derived from the same `LayerNode` graph used for compilation.
- Type checking in `packages/plugin`, `packages/core`, and `packages/app`.

## Implementation Status

Implemented. The initial host, inventory, rollback, and invariant registry landed before the production boot path used them. The follow-up runtime audit connected `PluginInternal` to a named Cordis profile, made boot await profile activation, ran invariants at readiness, and added derived `LayerNode` inspection. See the [runtime adoption audit](../researches/2026-08-14-deepseek-harness-2.md).

## Source

See [the DeepSeek Harness research report](../researches/2026-08-14-deepseek-harness.md).
