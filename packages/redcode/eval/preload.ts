// Eval runs reuse the unit-test isolation (temp XDG dirs and home, in-memory database, no browser,
// provider keys cleared) so a scripted run can never reach a real provider through ambient
// credentials. Live runs are the one exception: with REDCODE_EVAL_LIVE=1 the keys named in
// REDCODE_EVAL_KEEP_ENV (default: every *_API_KEY) are put back after the isolation runs, and the
// real models catalog is used instead of the test fixture.
const live = process.env.REDCODE_EVAL_LIVE === "1"
const keep = (process.env.REDCODE_EVAL_KEEP_ENV ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean)
const saved = live
  ? Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => keep.includes(name) || (!keep.length && /_API_KEY$|^AWS_|^GOOGLE_/.test(name)),
      ),
    )
  : {}

await import("../test/preload")

process.env.REDCODE_NO_BROWSER = "1"
process.env.REDCODE_DESIGN_NO_OPEN = "1"

if (live) {
  for (const [name, value] of Object.entries(saved)) process.env[name] = value
  delete process.env.REDCODE_MODELS_PATH
  delete process.env.REDCODE_DISABLE_MODELS_FETCH
}
