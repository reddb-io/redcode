# Redcode

RedDB's terminal coding agent, built on [OpenCode](https://github.com/anomalyco/opencode).
Redcode adds Design workflows, goals, System One evaluation, monitors, voice input,
and a RedSkills worker console. Attribution is preserved in [NOTICE](NOTICE).

## Install

```sh
npm install -g @reddb-io/redcode
redcode
```

Native archives for Linux, macOS and Windows are available from
[Redcode releases](https://github.com/reddb-io/redcode/releases). Each includes
`redcode` and `redcode-rpc-sidecar`; checksums are in `SHA256SUMS`.

## Use

| Command                     | Purpose                                         |
| --------------------------- | ----------------------------------------------- |
| `redcode`                   | Open the terminal UI                            |
| `redcode --yolo`            | Open with automatic permission approval         |
| `redcode setup` or `/setup` | Configure and check S2 and optional S1          |
| `/intelligence`             | Inspect selected models and session evaluations |
| `/design`                   | Switch to Design mode                           |
| `/design-open`              | Resume a Design conversation                    |
| `/design-review`            | Open the current conversation's browser review  |
| `/goal`                     | Start, inspect or control a session goal        |
| `/workers`                  | Inspect the RedSkills worker fleet              |
| `redcode run`               | Run a prompt without the full TUI               |
| `redcode serve`             | Run the HTTP server                             |
| `redcode acp`               | Run the Agent Client Protocol integration       |
| `redcode --help`            | List CLI commands                               |

The primary modes cycle through **Build → Plan → Design → Question**.
Question mode asks investigative questions with read-only tool access.
Design mode supports prototypes, browser feedback and an explicit approval handoff.

See [reasoning roles](docs/system-one.md) and [voice input](docs/voice-input.md).

## Development

Current implementation lives in `packages/core`, `packages/cli`, `packages/tui`,
`packages/server`, `packages/protocol` and `packages/schema`. `packages/redcode`
packages the CLI as Redcode. Internal `@opencode/*` package names preserve the
upstream architecture and do not change the published product name.

`main` is the development branch. Run `bun run check` for lint and type checking.
Tests run from package directories, never the repository root. Regenerate the
client with `bun run generate` in `packages/client` after changing the public API.

The migration still needs a complete comparison against the previous Redcode
experience. A successful build alone is not a claim of feature parity.

## Releases

Publish through the existing [redcode workflow](https://github.com/reddb-io/redcode/actions/workflows/redcode.yml):

```sh
gh workflow run redcode.yml --repo reddb-io/redcode --ref main -f publish=true
```

The workflow runs checks and tests, builds native CLI/sidecar and Design archives,
publishes npm packages, verifies installation and checksums, then publishes the
GitHub releases. Changesets record release intent for `@reddb-io/redcode`; the
workflow versions and publishes directly from `main`. See [CI/CD](docs/ci-cd.md).

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
