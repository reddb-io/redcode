import { unique } from "./unique.js"
import assert from "node:assert/strict"
import { performance } from "node:perf_hooks"

assert.deepEqual(unique([3, 1, 3, 2, 1]), [3, 1, 2])
assert.deepEqual(unique(["a", "b", "a"]), ["a", "b"])
assert.deepEqual(unique([]), [])
assert.deepEqual(unique([NaN, NaN, -0, 0]), [NaN, -0])

const values = Array.from({ length: 100_000 }, (_, index) => index)
const start = performance.now()
assert.equal(unique(values).length, values.length)
const elapsed = performance.now() - start
assert.ok(elapsed < 500, `100,000 unique values took ${Math.round(elapsed)}ms; expected under 500ms`)
console.log(`PASS ${Math.round(elapsed)}ms`)
