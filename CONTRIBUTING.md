# Contributing to Redcode

Redcode is reddb.io's coding agent for our own engineering work, built on
[OpenCode](https://github.com/anomalyco/opencode). See [README.md](./README.md) for what the
project is, and [NOTICE](./NOTICE) for full attribution.

## Where a contribution belongs

Redcode keeps its divergence from OpenCode narrow on purpose, so decide where a change belongs
before opening an issue or PR:

- **OpenCode's agent loop, providers, tools, LSP/formatter plumbing, or terminal UI foundation** —
  inherited from upstream and largely unchanged here. Send fixes and improvements to
  [anomalyco/opencode](https://github.com/anomalyco/opencode) instead.
- **Adding a new model provider** — providers are driven by
  [models.dev](https://github.com/anomalyco/models.dev); a new provider usually starts with a PR
  there rather than in this codebase.
- **Redcode-specific work** — the Session V2 runtime, the Cordis/Effect plugin host, the RedSkills
  Worker fleet integration, packaging and release, or anything else particular to this fork —
  belongs here, on [GitHub Issues at `reddb-io/redcode`](https://github.com/reddb-io/redcode/issues).

Redcode does not speak for the OpenCode project; please keep Redcode-specific issues off their
tracker, and vice versa.

## Reporting issues

Open an issue with the bug report or feature request template. Keep it short and specific — avoid
pasting large AI-generated summaries; issues that are mostly generated text may be closed or
ignored.

## Development setup

Requires Bun 1.3+.

```bash
bun install
bun dev
```

## Making a change

1. Work in an isolated worktree rather than the primary checkout, branched from `origin/main`:

   ```bash
   git worktree add .red/tmp/worktrees/manual/<slug> -b <branch> origin/main
   ```

   Don't create the branch with `git checkout -b` / `git switch -c` in the primary checkout, and
   don't switch the primary checkout's branch.

2. Name the branch with at most three hyphenated words and no type prefix — `session-recovery`,
   not `feat/session-recovery`.

3. Commit with conventional messages, `type(scope): summary` (`feat`, `fix`, `docs`, `chore`,
   `refactor`, `test`), and use the same convention for the PR title. Examples:
   `fix(tui): simplify thinking toggle styling`, `docs: update contributing guide`.

4. If the change is user-visible, add a changeset targeting `opencode`:

   ```markdown
   ---
   "@reddb-io/redcode": patch
   ---

   Describe the user-visible change.
   ```

   Use `patch`, `minor`, or `major` by impact. The generated Version PR is the only writer of
   release versions — don't bump `package.json` versions by hand.

5. Push the branch and open a PR against `main`.

## Tests and type checking

Run tests and typechecks from the package that owns them, never from the repository root — the
root `test` script exits 1 on purpose:

```bash
cd packages/redcode && bun test
cd packages/redcode && bun typecheck
```

## Style guide

`AGENTS.md` is the full style guide: general principles, imports, control flow, Effect
conventions, and the runtime rules code review enforces. `CONTEXT.md` is the domain vocabulary for
the Session runtime — read it before arguing about what a term means.
