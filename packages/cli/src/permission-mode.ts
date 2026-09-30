/**
 * `--auto` answers permission prompts that no rule denies. `--yolo` (also spelled
 * `--dangerously-skip-permissions`) does that and lifts the server's repository guard for destructive Git
 * commands. Neither lifts deny rules, secret protection or authentication, and automatic worktree isolation
 * applies in every mode.
 */
export function permissionMode(input: {
  readonly auto: boolean
  readonly yolo: boolean
  readonly dangerouslySkipPermissions: boolean
}) {
  const yolo = input.yolo || input.dangerouslySkipPermissions
  return { auto: input.auto || yolo, yolo }
}

/**
 * The guard runs on the server, which cannot see a client's auto-approve, so `--yolo` travels as
 * `REDCODE_YOLO=1` in the environment each Session carries (or a standalone server inherits).
 */
export function applyYoloFlag(yolo: boolean, env: Record<string, string | undefined> = process.env) {
  if (yolo) env.REDCODE_YOLO = "1"
}
