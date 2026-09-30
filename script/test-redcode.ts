import path from "node:path"

// Product contracts owned by this fork. The complete inherited suite remains opt-in in redcode.yml.
const suites = {
  core: [
    "test/agent.test.ts",
    "test/config/config.test.ts",
    "test/config/normalization.test.ts",
    "test/config/provider.test.ts",
    "test/config/reload.test.ts",
    "test/database-migration.test.ts",
    "test/database-stream.test.ts",
    "test/design-app-host.test.ts",
    "test/design-context.test.ts",
    "test/design-conversations.test.ts",
    "test/design-feedback.test.ts",
    "test/design-prompt.test.ts",
    "test/design-system.test.ts",
    "test/design-target.test.ts",
    "test/hook.test.ts",
    "test/instruction-discovery.test.ts",
    "test/instruction-state.test.ts",
    "test/intelligence/red-router-endpoint.test.ts",
    "test/intelligence/transport.test.ts",
    "test/intelligence/classification.test.ts",
    "test/intelligence/evaluation.test.ts",
    "test/intelligence/goal-command.test.ts",
    "test/intelligence/response.test.ts",
    "test/intelligence/subagent-review.test.ts",
    "test/models.test.ts",
    "test/plugin/provider-red-router.test.ts",
    "test/plugin/provider-openai-compatible.test.ts",
    "test/session-compaction.test.ts",
    "test/session-diff.test.ts",
    "test/session-goal-judge.test.ts",
    "test/session-instructions.test.ts",
    "test/session-model-request-hooks.test.ts",
    "test/session-model-suggestion.test.ts",
    "test/session-native-compaction.test.ts",
    "test/session-runner.test.ts",
    "test/session-stop-loss.test.ts",
    "test/session-tool-output-prune.test.ts",
    "test/v1-migration.test.ts",
    "test/tool-subagent.test.ts",
    "test/worktree.test.ts",
  ],
  cli: [
    "test/config.test.ts",
    "test/debug-guards-report.test.ts",
    "test/import-boundaries.test.ts",
    "test/server-connection.test.ts",
  ],
  server: [
    "test/intelligence-history.test.ts",
    "test/legacy-rpc.test.ts",
    "test/session-tasks.test.ts",
    "test/session-monitors.test.ts",
    "test/hooks.test.ts",
    "test/design-access.test.ts",
    "test/design-presence.test.ts",
    "test/design-ticket.test.ts",
    "test/session-diff.test.ts",
    "test/system-info.test.ts",
  ],
  tui: [
    "test/config-v2.test.tsx",
    "test/session-group-navigation.test.tsx",
    "test/redcode-workflows.test.tsx",
    "test/redcode-session.test.tsx",
    "test/redcode-theme.test.ts",
    "test/feature-plugins/sidebar-context.test.tsx",
    "test/feature-plugins/sidebar-footer.test.tsx",
    "test/voice-input.test.ts",
    "test/system-model.test.ts",
  ],
  schema: ["test/config.test.ts"],
  redcode: ["test/script/publish-registry.test.ts"],
  "rpc-sidecar": ["test/sidecar.test.ts"],
}

const failures: string[] = []
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
  if (result !== 0) failures.push(`${name} (exit ${result})`)
}

if (failures.length > 0) {
  console.error(`Failed Redcode contracts: ${failures.join(", ")}`)
  process.exit(1)
}
