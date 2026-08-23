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

const build = await Bun.file(path.join(root, "packages", "opencode", "script", "build.ts")).text()
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

const publishScript = await Bun.file(path.join(root, "packages", "opencode", "script", "publish.ts")).text()
for (const required of [
  '"redcode-rpc-sidecar": "./bin/redcode-rpc-sidecar"',
  'cp ./bin/opencode ${path.join(meta, "bin", "redcode-rpc-sidecar")}',
]) {
  if (!publishScript.includes(required)) throw new Error(`publish.ts is missing RPC sidecar contract ${required}`)
}

const launcher = await Bun.file(path.join(root, "packages", "opencode", "bin", "opencode")).text()
for (const required of ["REDCODE_RPC_SIDECAR_PATH", 'startsWith("redcode-rpc-sidecar")']) {
  if (!launcher.includes(required)) throw new Error(`npm launcher is missing RPC sidecar contract ${required}`)
}
for (const banned of ["beta", "docker", "desktop", "sst", "vscode"]) {
  if (publish.toLowerCase().includes(banned)) throw new Error(`red-publish.yml must not mention ${banned}`)
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

console.log("Redcode release posture: binary-only")
