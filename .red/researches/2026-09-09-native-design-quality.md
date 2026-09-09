# Native frontend quality review in Redcode

Date: 2026-09-09

Query: Study Unslop, OpenDesign and Impeccable; incorporate their best frontend practices and tool-driven identification/correction steps, with two cycles before the first human handoff.

Scope: Official repository source study and implementation in Redcode's shared Design instructions, playbooks, context discovery, renderer and Core/TUI tool responses. No external skill installation, external-agent delegation or paid generation benchmark is required for this workflow.

## Executive summary

The useful common pattern is context → coherent artifact → rendered evidence → specific critique → correction → equivalent recheck. Redcode already had briefs, immutable revisions, Playwright/axe audits, variant controls and human approval. Its missing connections were that audits mostly inspected the last scenario's state, captures had no structured manifest, and both `design_jobs` projections discarded the actual findings. Adding more style instructions alone would leave the agent unable to act on its own evidence.

Implement two review passes (structure/use, then craft/regression) with at most two correction cycles. Keep the live preview available for steering; the first formal handoff follows the passes. A clean review, explicit quick preview, interruption or no progress can stop sooner. Preserve human approval and disclose incomplete verification. This is native agent guidance using real tool results, not an enforced provider-turn scheduler or an aesthetic certification system.

## Official sources and version notes

Sources were cloned and read at these exact commits. They may evolve independently of this report.

- [Unslop README](https://github.com/mshumer/unslop/blob/edcb62386d129c65e4395f0cfcc9168eb1ba2148/README.md), MIT. Explains sampling, screenshot analysis and before/after comparison.
- [Unslop SaaS profile](https://github.com/mshumer/unslop/blob/edcb62386d129c65e4395f0cfcc9168eb1ba2148/profiles/react-design.md). A profile derived from 20 HTML samples and screenshots; its scope is startup SaaS landing pages, not all product interfaces.
- [Unslop implementation](https://github.com/mshumer/unslop/blob/edcb62386d129c65e4395f0cfcc9168eb1ba2148/unslop.py). The generation, screenshot, analysis and comparison steps are separate. Its sampling requires Claude Code and can make many model calls.
- [Impeccable craft floor](https://github.com/pbakaus/impeccable/blob/cd12f8660e2dde57b9615c8a6b8ea674101f9cfc/skill/reference/craft-floor.md), Apache-2.0. Observable typography, contrast, spacing, state, copy and artifact checks.
- [Impeccable finishing flow](https://github.com/pbakaus/impeccable/blob/cd12f8660e2dde57b9615c8a6b8ea674101f9cfc/skill/reference/new-work.md). Correction batches, recapture, bounded verdict rounds, and stopping on no progress.
- [Impeccable finishing reviewer](https://github.com/pbakaus/impeccable/blob/cd12f8660e2dde57b9615c8a6b8ea674101f9cfc/skill/agents/impeccable-finish-reviewer.md). Valid captures precede a verdict; compare the artifact with its brief/reference, not just a builder's narrative.
- [OpenDesign prompt composition](https://github.com/nexu-io/open-design/blob/81044a03ca717f77a5bde38947903a8ef222da8c/apps/daemon/src/prompts/system.ts), Apache-2.0. Product intent, brand context, craft references and verification guidance are composed into the working agent's prompt.
- [OpenDesign directions](https://github.com/nexu-io/open-design/blob/81044a03ca717f77a5bde38947903a8ef222da8c/apps/daemon/src/prompts/directions.ts). Concrete palettes, type stacks and layout postures make directions more actionable than mood labels.
- [OpenDesign critique panel](https://github.com/nexu-io/open-design/blob/81044a03ca717f77a5bde38947903a8ef222da8c/apps/daemon/src/prompts/panel.ts) and [contract](https://github.com/nexu-io/open-design/blob/81044a03ca717f77a5bde38947903a8ef222da8c/packages/contracts/src/critique.ts). Separate visual, brand, accessibility and copy lenses; configurable rounds, convergence and fallback.
- [OpenDesign official prompt](https://github.com/nexu-io/open-design/blob/81044a03ca717f77a5bde38947903a8ef222da8c/apps/daemon/src/prompts/official-system.ts). Documents a one-render-check budget and an instruction to omit render failures from the visible response. Redcode deliberately chooses a different behavior: bounded checks with disclosed unverified scope.

These are source observations, not claims that upstream defaults guarantee better generated designs. The locally installed Impeccable skill predates the fetched repository; the repository commit above is the research reference. Redcode's text and implementation are an independent synthesis, not vendored upstream code or complete copied skill files.

## Findings and adopted behavior

| Source idea | Opportunity in Redcode | Adopted behavior |
| --- | --- | --- |
| Unslop measures repeated defaults rather than assuming them | Recognize generic compositions while preserving justified patterns | Rendered advisory signals with concrete targets; visual review counts repetitions and compares variants |
| Unslop before/after comparison | Changes can remove a symptom without improving the composition | Re-audit a new immutable revision and compare the same target/state/width |
| Impeccable context and craft | Token-only context omits audience, tasks and anti-references | Discover PRODUCT.md and DESIGN.md in supported project context directories, preserving paths/hashes |
| Impeccable valid captures before verdict | A screenshot path alone is not evidence the agent inspected it | Tool output lists actual captures; workflow requires image-capable reads or an explicit unverified result |
| Impeccable bounded corrections | Repeated polish can consume tokens without progress | Two review passes, at most two correction cycles; stop on no progress and expose remaining findings |
| OpenDesign's distinct critique lenses | Aesthetic polish can conceal missing functionality | Review task fit, visual hierarchy, brand fidelity, accessibility and copy, with explicit evidence |
| OpenDesign's concrete directions | Recoloring a template does not create meaningful variants | Compare structure, reading order, density and interaction; retain the user's chosen direction |
| Existing Redcode immutable revisions and approval | Old reports can be mistaken for verification of new work | Only an audit matching the current revision is presented as current; older evidence is labeled |

## What counts as a signal

Automated checks use rendered DOM/computed styles. They do not classify authorship or produce a universal "slop score".

- `gradient-heading`: gradient-filled text. Review whether it serves the brief and preserves hierarchy/contrast.
- `decorative-glass`: a rendered backdrop filter. Review whether layering has a purpose.
- `repeated-card-layout`: three or more equal-sized heading/prose cards in a flex/grid container. Equal comparison can justify this pattern.
- `generic-copy`: a small English heuristic vocabulary for filler. Other languages and subtle unsupported claims require review in context.
- `placeholder-link`: an empty or `#` target. It may have a working local handler; exercise it before deciding.
- `small-control`: a control shorter than 24px. This is an invitation to inspect target size and spacing exceptions, not a complete WCAG verdict.
- `broken-image`: a rendered image without decoded pixels. Correct/import the local resource and render again.
- Existing axe violations, horizontal overflow, script errors and failed scenarios remain separately reported technical findings.

Review additionally covers fabricated metrics/logos/testimonials, empty oversized sections, low-value decoration, inconsistent icon/control vocabulary, category-reflex palettes, readability, focus, error recovery and reduced motion. A specific brand choice can justify a style signal; record the rationale instead of deleting identity to satisfy a detector.

## Tool workflow

1. `design_document` create/list, then update the brief, design system, decisions and observable scenarios. Read relevant product documents, tokens and components. `scenario.variant` limits a scenario to one marked direction; omitted means every direction.
2. `design_playbook {"id":"quality"}` plus the matching screen/flow/comparison playbook, automatically invoked by the agent.
3. Author the prototype in its permitted root. `design_preview {id,name}` freezes the draft.
4. `design_export {id,input:{revision,format:"audit"}}`, then `design_jobs {id}` until terminal. Audit each marked variant at 390/768/1440px, from a fresh initial load and from each applicable scenario's resulting state.
5. Read the returned PNGs with the native image-capable read tool. Consult the HTML report when findings are truncated. Run the structure/use pass; save revision-linked `quality/round-1` decisions containing target, evidence, impact and intended correction.
6. Apply material corrections with native edit/write/apply_patch. If assets matter, discover capabilities using `design_media`, call `design_generate` with its actual advertised schema, or import with `design_asset`. Do not invent unsupported generation arguments.
7. Republish, re-audit and inspect equivalent captures. Run the craft/regression pass; record `quality/round-2` decisions and resolved/partial/unresolved/accepted-with-reason dispositions. One further correction batch is available; verify it on a fresh revision.
8. Hand over the reviewed proposal with a compact summary, open issues and coverage limits. The existing browser review, variant selection and explicit approval remain the user experience. `design_exit` still requires human approval; quality review never authorizes Build.

## Persistence, limits and failure behavior

Audit checks and capture manifests are optional additions to `Design.Audit`, so historical jobs and approval packages remain decodable. Reports and images stay with their audit job. The API continues to use its existing Schema/HttpApi boundary; no new file format or transport is introduced. Regenerate Client types after the shared schema changes.

The renderer keeps its existing cancellable 120-second job deadline. Each audit examines at most six variants and captures at most 36 views; missing coverage is reported. Screenshots cover full pages up to 12000px tall, otherwise only the viewport with an explicit limitation. DOM heuristic inspection is capped at 2000 rendered elements, and the model projection bounds findings while linking the complete report. These are resource limits, not evidence of completeness.

The two-cycle policy is guidance loaded by both Design runtimes. It does not enforce extra durable Session inputs, create hidden provider drains, call external agents or prevent the user from reviewing work in progress. Automated results cannot prove subjective visual quality, full accessibility, all keyboard paths or normal-motion behavior. A timeout, invalid capture, unsupported image reader or unexercised scenario remains unverified.

## Deliberately not adopted

- A copied universal blacklist of fonts, colors, cards or standard product controls. Upstream aesthetic prescriptions vary and sometimes conflict; product context must win.
- Fabricated jury disagreement, a requirement to invent a defect in every round, or a numerical aesthetic score used as approval.
- Hiding a rendering failure from the user while presenting a verified result.
- Running Unslop's multi-sample provider benchmark in every Design conversation. That is a separate evaluation workload and would be expensive and misleading as a per-screen classifier.
- Installing external skills or creating extra commands the user must remember.

## Validation and next opportunities

Implementation tests exercise real Playwright rendering: isolated variants, initial and post-click states (including state on the variant root), gradient signals, missing image failures, interaction-induced overflow, a corrected second revision, screenshot manifests, stale-report handling and unchanged approval state. Context discovery tests verify source provenance and directory boundaries. Core and TUI registry tests check the model-facing audit evidence, and Schema tests retain historical audit/scenario decoding. Existing audit/approved-implementation comparison remains covered.

A future opt-in benchmark can measure model-specific repeated compositions across a fixed brief corpus, compare before/after captures, and collect blinded human preferences. That is the appropriate place to test whether these practices improve actual design quality; this change claims tool/context fidelity, not measured aesthetic gains. A separate future policy could make review progress a first-class persisted workflow state if instruction adherence proves insufficient, without conflating it with human approval.
