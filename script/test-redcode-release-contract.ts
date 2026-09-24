#!/usr/bin/env bun

import path from "path"
import os from "os"
import fs from "fs/promises"

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
  "nix-eval.yml",
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
// design-publish.yml releases the design app to GitHub only: it may create a release, nothing else.
const offenders = sources.flatMap((source) =>
  source.file === "red-publish.yml"
    ? []
    : forbiddenCommands
        .filter((command) => !(source.file === "design-publish.yml" && command === "gh release create"))
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
  "./packages/redcode/script/build.ts",
  "./packages/redcode/script/publish.ts",
  "@reddb-io/redcode",
  "id-token: write",
  "Refuse refs that cannot publish",
  "Unpack npm packages from the published GitHub Release assets",
  "bun packages/redcode/script/npm-release-assets.ts",
  "NPM_PUBLISH_MODE: ${{ vars.NPM_PUBLISH_MODE }}",
  "NPM_TOKEN: ${{ vars.NPM_PUBLISH_MODE == 'token' && secrets.NPM_TOKEN || '' }}",
  'npm config set //registry.npmjs.org/:_authToken "${NODE_AUTH_TOKEN}"',
  "Smoke the uploaded GitHub Release asset",
  "npm_only",
  "workflow_dispatch:",
  "Existing draft Redcode tag to reconcile",
  "released tags are immutable",
  "https://github.com/reddb-io/redcode",
  "REDCODE_RPC_SIDECAR_DIR",
  "redcode-rpc-sidecar-linux-x64",
  "redcode-rpc-sidecar-linux-arm64",
  "redcode-rpc-sidecar-linux-x64-musl",
  "redcode-rpc-sidecar-linux-arm64-musl",
  "redcode-rpc-sidecar-windows-x64.exe",
  "redcode-rpc-sidecar-windows-arm64.exe",
  "redcode-rpc-sidecar-darwin-x64",
  "redcode-rpc-sidecar-darwin-arm64",
  "x86_64-linux-gnu.2.29",
  "aarch64-linux-gnu.2.29",
  "x86_64-linux-musl",
  "aarch64-linux-musl",
  "x86_64-windows-gnu",
  "aarch64-windows-gnu",
  "macos-15-intel",
  "macos-15",
  'deployment: "11.0"',
  "/Applications/Xcode_16.4.app/Contents/Developer",
  "node-version: 24.11.1",
  "Verify RPC sidecar target",
  "zig-x86_64-linux-0.17.0-dev.1857+3c46da14d.tar.xz",
  "0825e4a55baf4a6647c3ce3077a7236c9ffec5b17e1ca0102a930fe33d631bc6",
]) {
  if (!publish.includes(required)) throw new Error(`red-publish.yml is missing ${required}`)
}

// Structure, not just text: OIDC publishing rights stay confined to the npm job, and the GitHub
// Release is published only after everything the npm job needs has been handed over.
type WorkflowStep = { name?: string; uses?: string; if?: string; run?: string }
type WorkflowJob = { permissions?: Record<string, string>; needs?: string | string[]; steps?: WorkflowStep[] }
const workflow = Bun.YAML.parse(publish) as { permissions?: Record<string, string>; jobs: Record<string, WorkflowJob> }
if (JSON.stringify(workflow.permissions) !== JSON.stringify({ contents: "read" }))
  throw new Error(`red-publish.yml top-level permissions must be exactly contents: read`)
for (const [id, job] of Object.entries(workflow.jobs)) {
  if (id !== "npm" && job.permissions?.["id-token"] !== undefined)
    throw new Error(`red-publish.yml grants id-token to job ${id}; only the npm job may request OIDC tokens`)
}
const npmJob = workflow.jobs.npm
if (npmJob?.permissions?.["id-token"] !== "write" || npmJob.needs !== "release")
  throw new Error("red-publish.yml npm job must need release and hold id-token: write")
if (npmJob.steps?.[0]?.name !== "Refuse refs that cannot publish")
  throw new Error("red-publish.yml npm job must start by refusing refs that cannot publish")
const npmVersion = npmJob.steps
  ?.map((step) => /npm install -g npm@(\d+)\.(\d+)\.(\d+)/.exec(step.run ?? ""))
  .find(Boolean)
if (
  !npmVersion ||
  Number(npmVersion[1]) * 1_000_000 + Number(npmVersion[2]) * 1_000 + Number(npmVersion[3]) < 11_019_001
)
  throw new Error("red-publish.yml npm job must install npm 11.19.1 or newer (trusted publishing and npm stage)")
const releaseSteps = workflow.jobs.release?.steps ?? []
const releaseLast = releaseSteps.at(-1)
const bundleUpload = releaseSteps.findIndex((step) => step.uses?.startsWith("actions/upload-artifact@"))
if (releaseLast?.name !== "Publish GitHub Release" || bundleUpload < 0 || bundleUpload > releaseSteps.length - 2)
  throw new Error(
    "red-publish.yml must publish the GitHub Release as the release job's last step, after the npm bundle upload",
  )
if (releaseLast.if !== "steps.state.outputs.state != 'published'")
  throw new Error("red-publish.yml must never edit a GitHub Release that is already published")

const build = await Bun.file(path.join(root, "packages", "redcode", "script", "build.ts")).text()
for (const required of ["SHA256SUMS", 'new Bun.CryptoHasher("sha256")', "./dist/SHA256SUMS"]) {
  if (!build.includes(required)) throw new Error(`build.ts is missing release integrity contract ${required}`)
}
for (const required of [
  "REDCODE_RPC_SIDECAR_DIR",
  "missing staged RPC sidecar",
  'throw new Error("REDCODE_RPC_SIDECAR_DIR is required for release builds")',
  "redcode-rpc-sidecar",
]) {
  if (!build.includes(required)) throw new Error(`build.ts is missing RPC sidecar contract ${required}`)
}

const sidecarBuild = await Bun.file(path.join(root, "packages", "rpc-sidecar", "script", "build.ts")).text()
for (const required of ["REDCODE_RPC_SIDECAR_TARGET", "SCRIPTC_TARGET", 'SCRIPTC_CC = "zigcc"']) {
  if (!sidecarBuild.includes(required))
    throw new Error(`RPC sidecar build is missing cross-target contract ${required}`)
}
if (publish.includes("@ziglang/cli")) throw new Error("red-publish.yml must not use the mutable @ziglang/cli download")

const publishScript = await Bun.file(path.join(root, "packages", "redcode", "script", "publish.ts")).text()
for (const required of [
  '"redcode-rpc-sidecar": "./bin/redcode-rpc-sidecar"',
  'cp ./bin/redcode ${path.join(meta, "bin", "redcode-rpc-sidecar")}',
]) {
  if (!publishScript.includes(required)) throw new Error(`publish.ts is missing RPC sidecar contract ${required}`)
}

const launcher = await Bun.file(path.join(root, "packages", "redcode", "bin", "redcode")).text()
for (const required of ["REDCODE_RPC_SIDECAR_PATH", 'startsWith("redcode-rpc-sidecar")']) {
  if (!launcher.includes(required)) throw new Error(`npm launcher is missing RPC sidecar contract ${required}`)
}
for (const banned of ["beta", "docker", "desktop", "sst", "vscode"]) {
  if (publish.toLowerCase().includes(banned)) throw new Error(`red-publish.yml must not mention ${banned}`)
}

// The design app has its own releases, which must never displace redcode's latest release.
const design = await Bun.file(path.join(workflows, "design-publish.yml")).text()
for (const required of [
  "github.repository == 'reddb-io/redcode'",
  '"design-v[0-9]+.[0-9]+.[0-9]+"',
  "group: design-publish",
  "workflow_dispatch:",
  "released tags are immutable",
  'gh release create "$TAG" --verify-tag --draft --latest=false',
  'gh release edit "$TAG" --draft=false --latest=false',
  "bun packages/design-app/script/build.ts --release --upload",
  "Smoke the uploaded GitHub Release asset",
]) {
  if (!design.includes(required)) throw new Error(`design-publish.yml is missing ${required}`)
}
if (/--latest(?!=false)/.test(design)) throw new Error("design-publish.yml must never mark its release latest")
const designWorkflow = Bun.YAML.parse(design) as {
  permissions?: Record<string, string>
  jobs: Record<string, WorkflowJob>
}
if (JSON.stringify(designWorkflow.permissions) !== JSON.stringify({ contents: "read" }))
  throw new Error("design-publish.yml top-level permissions must be exactly contents: read")
if (Object.values(designWorkflow.jobs).some((job) => job.permissions?.["id-token"] !== undefined))
  throw new Error("design-publish.yml must not request OIDC tokens")
if (designWorkflow.jobs.release?.steps?.at(-1)?.name !== "Publish GitHub Release")
  throw new Error("design-publish.yml must publish the GitHub Release as its last step")
const designBuild = await Bun.file(path.join(root, "packages", "design-app", "script", "build.ts")).text()
for (const required of ["SHA256SUMS", 'new Bun.CryptoHasher("sha256")', "manifest.json", "redcode-whiteboard-"]) {
  if (!designBuild.includes(required)) throw new Error(`design app build.ts is missing release contract ${required}`)
}

const release = await Bun.file(path.join(workflows, "red-release.yml")).text()
for (const required of [
  "branches: [main]",
  "changesets/action@a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d",
  "bun run release:version",
  "bun script/red-tag-release.ts",
  "createGithubReleases: false",
]) {
  if (!release.includes(required)) throw new Error(`red-release.yml is missing ${required}`)
}

const changesets = await Bun.file(path.join(root, ".changeset", "config.json")).json()
if (changesets.baseBranch !== "main") throw new Error("Changesets baseBranch must be main")
if (changesets.privatePackages?.version !== true)
  throw new Error("Changesets must version the private opencode product package")

const staleDefault = sources.flatMap((source) =>
  source.text.includes("branches: [dev]") ? [`${source.file}: branches: [dev]`] : [],
)
if (staleDefault.length > 0) throw new Error(`workflow still targets dev: ${staleDefault.join(", ")}`)

// `changeset status` does not validate the skipped-package dependency graph.
// Exercise the real version command without changing the checkout's versions.
const preview = await fs.mkdtemp(path.join(os.tmpdir(), "redcode-version-check-"))
try {
  const workspace = await Bun.file(path.join(root, "package.json")).json()
  await Bun.write(path.join(preview, "package.json"), Bun.file(path.join(root, "package.json")))
  for (const pattern of workspace.workspaces.packages) {
    for await (const file of new Bun.Glob(`${pattern}/package.json`).scan({ cwd: root })) {
      await Bun.write(path.join(preview, file), Bun.file(path.join(root, file)))
    }
  }
  await fs.cp(path.join(root, ".changeset"), path.join(preview, ".changeset"), { recursive: true })
  await fs.symlink(path.join(root, "node_modules"), path.join(preview, "node_modules"), "junction")
  const version = Bun.spawn(["node", path.join(root, "node_modules", "@changesets", "cli", "bin.js"), "version"], {
    cwd: preview,
    stdout: "inherit",
    stderr: "inherit",
  })
  if ((await version.exited) !== 0) throw new Error("Changesets version rehearsal failed")
} finally {
  await fs.rm(preview, { recursive: true, force: true })
}

console.log("Redcode release posture: binary-only")
