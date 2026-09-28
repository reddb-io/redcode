import path from "node:path"

// Product contracts owned by this fork. The complete inherited suite remains opt-in in test.yml.
const suites = {
  core: [
    "test/agent.test.ts",
    "test/config/config.test.ts",
    "test/config/normalization.test.ts",
    "test/config/provider.test.ts",
    "test/config/reload.test.ts",
    "test/database-migration.test.ts",
    "test/database-stream.test.ts",
    "test/design-conversations.test.ts",
    "test/instruction-discovery.test.ts",
    "test/instruction-state.test.ts",
    "test/models.test.ts",
    "test/session-compaction.test.ts",
    "test/session-instructions.test.ts",
    "test/session-model-request-hooks.test.ts",
    "test/session-runner.test.ts",
    "test/session-tool-output-prune.test.ts",
    "test/v1-migration.test.ts",
    "test/worktree.test.ts",
  ],
  cli: ["test/config.test.ts", "test/import-boundaries.test.ts", "test/server-connection.test.ts"],
  server: ["test/intelligence-history.test.ts", "test/legacy-rpc.test.ts", "test/session-tasks.test.ts"],
  tui: [
    "test/redcode-workflows.test.tsx",
    "test/redcode-session.test.tsx",
    "test/redcode-theme.test.ts",
    "test/voice-input.test.ts",
  ],
  schema: ["test/config.test.ts"],
  redcode: ["test/script/publish-registry.test.ts"],
  "rpc-sidecar": ["test/sidecar.test.ts"],
}

for (const [name, files] of Object.entries(suites)) {
  const cwd = path.resolve(import.meta.dir, "../packages", name)
  for (const file of files) {
    if (!(await Bun.file(path.join(cwd, file)).exists())) throw new Error(`Missing Redcode contract: ${name}/${file}`)
  }
  console.log(`${name}: ${files.length} Redcode contract files`)
  if (process.argv.includes("--list")) continue
  const result = await Bun.spawn([process.execPath, "run", "test", ...files], {
    cwd,
    env: { ...process.env, GITHUB_ACTIONS: "false" },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).exited
  if (result !== 0) process.exit(result)
}
