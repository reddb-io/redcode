process.env.OPENCODE_DB = ":memory:"
process.env.NPM_CONFIG_AUDIT = "false"
// Tests must never open a real browser or system opener on the developer machine.
process.env.REDCODE_NO_BROWSER = "1"
// The runner consults System One on every prompt in dual reasoning; tests must not reach the developer's evaluator.
process.env.REDCODE_REASONING = "single"
