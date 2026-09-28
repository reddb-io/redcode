# Redcode migration contract

Redcode remains the product. OpenCode V2 supplies the new technical foundation.
The migration must preserve the behavior and experience of Redcode before the
migration, including its improvements over upstream. Upstream defaults do not
replace Redcode product decisions.

## Reference

Use the pre-migration Redcode history at
`8542747fc2b4e6589742358e10f8f2a38baa4820` (`b270378237^2`) when comparing
features, interactions, configuration, and documentation. Compare current work
against `main`; keep development on `main`.

## Experience to preserve

- Redcode product identity throughout launch, the terminal, setup, and updates.
- S1/S2 setup, explicit model roles, effective configuration, evaluation history,
  and visible unavailable or inconclusive evaluator states.
- Design as an integrated workflow: start, resume, browser review, feedback, and
  handoff to implementation.
- Question as an investigative, read-only mode; the primary agent cycle remains
  Build → Plan → Design → Question → Build.
- Voice dictation into the current composer, preserving attachments and drafts,
  without submitting the prompt automatically.
- Existing Redcode commands, configuration, sessions, goals, and integrations.

## Current restoration status

These are implementation and validation states, not a declaration of full parity.

| Area                    | Implemented restoration                                           | Remaining validation                                                    |
| ----------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Product identity        | Redcode CLI/TUI branding                                          | Installed release launch                                                |
| S1/S2                   | `/setup`, `/intelligence`, footer status, history API             | CI, real provider setup and evaluation                                  |
| Design                  | `/design`, `/design-open`, `/design-review`, conversation listing | CI, browser feedback and handoff journey                                |
| Voice                   | Composer socket integration and draft preservation                | CI, actual dictation client integration                                 |
| Commands                | `/mcp` compatibility alias                                        | Complete comparison of previous command surfaces, including `/hooks`    |
| Other existing features | Core Question, goals, intelligence, and monitors remain present   | Behavior parity, workspace UX, model suggestions, primary agent cycling |

Regression tests were added for the production TUI commands, Design conversation
queries, authenticated evaluation history, and the voice socket. They must run
through GitHub Actions. No local test run is required for this migration workflow.

## Completion gate

A successful build or a restored logo alone does not establish migration parity.
Track missing behavior explicitly, validate the restored user journeys, and run
the existing checks and tests in CI against the actual restoration commit before
publishing through the existing `redcode` workflow. Do not describe all previous
features as preserved until the comparison and behavioral validation support it.
