process.env.OPENCODE_DB = ":memory:"
process.env.NPM_CONFIG_AUDIT = "false"
// Tests must never open a real browser or system opener on the developer machine.
process.env.REDCODE_NO_BROWSER = "1"
