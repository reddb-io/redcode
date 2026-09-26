# Redcode GitHub Action

Run Redcode from issue comments, pull request comments, reviews, and other GitHub Actions events. The action uses the Redcode V2 CLI and the same session backend as the terminal client.

## Install

From the target repository, run:

```bash
redcode github install
```

The command selects a provider and model, checks the GitHub App installation, and writes `.github/workflows/redcode.yml`. Commit that file and add the provider secrets shown by the installer. The generated workflow responds to `/oc` and `/opencode` comments.

The workflow uses `reddb-io/redcode/github@main`. It installs `@reddb-io/redcode` and runs `redcode github run`. The Action requires `id-token: write` to exchange a GitHub App token. Its `use_github_token` input can use the workflow's `GITHUB_TOKEN` instead.

## Supported events

`github run` handles `issue_comment`, `pull_request_review_comment`, `issues`, `pull_request`, `schedule`, and `workflow_dispatch`. Add the extra triggers to your workflow when needed. For `issues`, `schedule`, and `workflow_dispatch`, supply the `prompt` input because there is no command comment to use as a prompt.

For issue tasks, Redcode creates a branch and opens a pull request when it changes files. For pull requests, it works on the pull request branch and posts its response. For scheduled and manually dispatched runs, it logs the response and opens a pull request when it changes files. A commenter must have write or admin access to the repository.

## Manual workflow

```yaml
name: redcode
on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
jobs:
  redcode:
    if: contains(github.event.comment.body, '/oc') || contains(github.event.comment.body, '/opencode')
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: write
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
      - uses: reddb-io/redcode/github@main
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        with:
          model: anthropic/claude-sonnet-4-20250514
```

Adjust the provider, model, and secret for your account. When using `use_github_token: true`, the action reads `github.token` and does not need the GitHub App exchange.

## Local development

Use a checkout of this repository with Bun installed. Run the V2 CLI from the repository root with a JSON event context and a GitHub token:

```bash
MODEL=anthropic/claude-sonnet-4-20250514 \
GITHUB_RUN_ID=local \
GITHUB_TOKEN=github_pat_example \
USE_GITHUB_TOKEN=true \
bun run dev github run --event '{"eventName":"issue_comment","repo":{"owner":"example","repo":"project"},"actor":"example","payload":{"issue":{"number":1},"comment":{"id":1,"body":"/oc summarize this issue"}}}'
```

The event's repository and issue must exist, and the token needs write access. The command runs against a standalone V2 server. It can create comments, branches, and pull requests in that repository.
