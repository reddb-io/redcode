import { confirm, intro, log, outro, select, spinner } from "@clack/prompts"
import { ModelsDev } from "@opencode/core/models-dev"
import { Effect } from "effect"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { handlePromptErrors, openUrl, prompt, requireInteractive } from "../../../ui/prompt"

const WORKFLOW_FILE = ".github/workflows/redcode.yml"
const APP_URL = "https://github.com/apps/opencode-agent"
const priority = new Map([
  ["opencode", 0],
  ["anthropic", 1],
  ["openai", 2],
  ["google", 3],
])

export default Runtime.handler(
  Commands.commands.github.commands.install,
  () => Effect.gen(function* () {
    yield* requireInteractive("Run redcode github install in an interactive terminal")
    intro("Install Redcode GitHub agent")
    const repository = yield* Effect.promise(readRepository)
    const providers = yield* ModelsDev.bundled
    const provider = yield* prompt<string>(() =>
      select({
        message: "Select provider",
        options: providers
          .filter((item) => item.info.id !== "github-copilot" && item.models.length > 0)
          .toSorted(
            (a, b) =>
              (priority.get(a.info.id) ?? priority.size) - (priority.get(b.info.id) ?? priority.size) ||
              a.info.name.localeCompare(b.info.name),
          )
          .map((item) => ({ label: item.info.name, value: item.info.id })),
      }),
    )
    const selected = providers.find((item) => item.info.id === provider)
    if (!selected) return yield* Effect.fail(new Error(`Provider ${provider} was not found`))
    const model = yield* prompt<string>(() =>
      select({
        message: "Select model",
        options: selected.models
          .filter((item) => item.status !== "deprecated")
          .toSorted((a, b) => a.name.localeCompare(b.name))
          .map((item) => ({ label: item.name, value: item.id })),
      }),
    )

    const workflow = path.join(repository.root, WORKFLOW_FILE)
    if (yield* Effect.promise(() => Bun.file(workflow).exists())) {
      const overwrite = yield* prompt<boolean>(() =>
        confirm({ message: `${WORKFLOW_FILE} already exists. Replace it?`, initialValue: false }),
      )
      if (!overwrite) {
        outro("Cancelled")
        return
      }
    }

    const progress = spinner()
    progress.start("Checking GitHub App installation")
    const installed = yield* Effect.promise(() => hasInstallation(repository.owner, repository.repo))
    progress.stop(installed ? "GitHub App installed" : "GitHub App installation required")
    if (!installed) {
      log.info(`Install the GitHub App for ${repository.owner}/${repository.repo}: ${APP_URL}`)
      yield* openUrl(APP_URL)
      progress.start("Waiting for GitHub App installation")
      const ready = yield* Effect.promise(async () => {
        for (let attempt = 0; attempt < 120; attempt++) {
          if (await hasInstallation(repository.owner, repository.repo)) return true
          await Bun.sleep(1000)
        }
        return false
      })
      progress.stop(ready ? "GitHub App installed" : "GitHub App installation not detected")
      if (!ready) return yield* Effect.fail(new Error(`Install the GitHub App for ${repository.owner}/${repository.repo} and retry`))
    }

    yield* Effect.promise(() => mkdir(path.dirname(workflow), { recursive: true }))
    yield* Effect.promise(() => Bun.write(workflow, workflowText(provider, model, selected.environment)))
    log.success(`Added ${WORKFLOW_FILE}`)
    const secrets = provider === "amazon-bedrock" ? [] : selected.environment
    outro(
      [
        `Commit ${WORKFLOW_FILE} and push it.`,
        secrets.length ? `Add provider secrets in ${repository.owner}/${repository.repo}: ${secrets.join(", ")}` : "",
        "Comment /oc summarize on an issue to try the agent.",
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }).pipe(handlePromptErrors),
)

async function readRepository() {
  const root = (await Bun.$`git rev-parse --show-toplevel`.quiet().text()).trim()
  const remote = (await Bun.$`git remote get-url origin`.quiet().text()).trim()
  const match = remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!match) throw new Error("The origin remote must point to a GitHub repository")
  return { root, owner: match[1], repo: match[2] }
}

async function hasInstallation(owner: string, repo: string) {
  const url = new URL("https://api.opencode.ai/get_github_app_installation")
  url.searchParams.set("owner", owner)
  url.searchParams.set("repo", repo)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not check GitHub App installation: HTTP ${response.status}`)
  const data: unknown = await response.json()
  return typeof data === "object" && data !== null && "installation" in data && Boolean(data.installation)
}

function workflowText(provider: string, model: string, environment: readonly string[]) {
  const secrets = provider === "amazon-bedrock" ? [] : environment
  const credentials = secrets.length
    ? `\n        env:${secrets.map((name) => `\n          ${name}: \${{ secrets.${name} }}`).join("")}`
    : ""
  return `name: redcode

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]

jobs:
  redcode:
    if: |
      contains(github.event.comment.body, ' /oc') ||
      startsWith(github.event.comment.body, '/oc') ||
      contains(github.event.comment.body, ' /opencode') ||
      startsWith(github.event.comment.body, '/opencode')
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: write
      pull-requests: write
      issues: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6
        with:
          persist-credentials: false

      - name: Run Redcode
        uses: reddb-io/redcode/github@main${credentials}
        with:
          model: ${JSON.stringify(`${provider}/${model}`)}
`
}
