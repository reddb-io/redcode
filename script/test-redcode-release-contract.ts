#!/usr/bin/env bun

import path from "path"

const root = path.resolve(import.meta.dir, "..")
const workflows = path.join(root, ".github", "workflows")
const forbidden = [
  "beta.yml",
  "close-issues.yml",
  "close-prs.yml",
  "compliance-close.yml",
  "containers.yml",
  "deploy.yml",
  "docs-locale-sync.yml",
  "docs-update.yml",
  "duplicate-issues.yml",
  "generate.yml",
  "nix-hashes.yml",
  "notify-discord.yml",
  "opencode.yml",
  "pr-management.yml",
  "pr-standards.yml",
  "publish.yml",
  "publish-github-action.yml",
  "publish-vscode.yml",
  "release-github-action.yml",
  "review.yml",
  "stats.yml",
  "triage.yml",
]
const present = await Promise.all(
  forbidden.map(async (file) => ((await Bun.file(path.join(workflows, file)).exists()) ? file : "")),
)
if (present.some(Boolean))
  throw new Error(`upstream deployment workflows are active: ${present.filter(Boolean).join(", ")}`)

const active = await Array.fromAsync(new Bun.Glob("*.yml").scan({ cwd: workflows }))
const sources = await Promise.all(
  active.map(async (file) => ({ file, text: await Bun.file(path.join(workflows, file)).text() })),
)
const forbiddenCommands = ["sst deploy", "docker buildx build --platform", "npm publish", "gh release create"]
const offenders = sources.flatMap((source) =>
  source.file === "red-publish.yml"
    ? []
    : forbiddenCommands
        .filter((command) => source.text.includes(command))
        .map((command) => `${source.file}: ${command}`),
)
if (offenders.length > 0) throw new Error(`deployment command outside red-publish.yml: ${offenders.join(", ")}`)

const inheritedAutomation = sources.flatMap((source) =>
  ["https://opencode.ai/install", "anomalyco/opencode/github", "sst/opencode/github"]
    .filter((marker) => source.text.includes(marker))
    .map((marker) => `${source.file}: ${marker}`),
)
if (inheritedAutomation.length > 0)
  throw new Error(`upstream agent automation is active: ${inheritedAutomation.join(", ")}`)

const publish = await Bun.file(path.join(workflows, "red-publish.yml")).text()
for (const required of [
  "github.repository == 'reddb-io/redcode'",
  '"v[0-9]+.[0-9]+.[0-9]+"',
  "group: red-publish",
  "name: red-release",
  "token: ${{ secrets.RELEASE_PAT }}",
  "./packages/opencode/script/build.ts",
  "./packages/opencode/script/publish.ts",
  "@reddb-io/redcode",
  "NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}",
  'npm config set //registry.npmjs.org/:_authToken "${NODE_AUTH_TOKEN}"',
]) {
  if (!publish.includes(required)) throw new Error(`red-publish.yml is missing ${required}`)
}
for (const banned of ["beta", "docker", "desktop", "sst", "vscode"]) {
  if (publish.toLowerCase().includes(banned)) throw new Error(`red-publish.yml must not mention ${banned}`)
}

console.log("Redcode release posture: binary-only")
