# Design implementation

Accepted scope: SessionV2 only; new and existing interfaces; React/Solid components and portable HTML; image generation through MCP/plugins; editable SVG and local GIF export. No V1 adapters or data migration.

Completion requires all seven slices and the three end-to-end journeys from the approved plan:

- [x] V2 domain, immutable revisions, durable feedback and approval handoff.
- [x] Shared review UI, both entry journeys and persistent drafts.
- [x] Design-system provenance, alternatives, history and direct adjustments.
- [x] React/Solid builds, local renderer and exercised scenarios.
- [x] Canonical MCP/plugin tools and versioned local assets.
- [x] Editable SVG animation and deterministic local GIF export.
- [x] Approved-versus-implemented comparison, documentation, generated clients and release entry.

Verification: package-local tests/typechecks; real browser interactions for new interface, existing component and SVG-to-GIF journeys; failure and retry scenarios; migration/code-generation checks. Keep this checklist accurate as work proceeds.

Completed on 2026-09-07. The V1 implementation and its route-specific tests were removed; vendored whiteboard/export helpers and their 179 tests remain. Shared review uses a native DOM mount with a Solid application wrapper, with the same implementation serialized for standalone review.

Validation evidence and measured performance are recorded in [validation.md](./validation.md). Connected image providers are integration points; no paid image service was used during verification.
