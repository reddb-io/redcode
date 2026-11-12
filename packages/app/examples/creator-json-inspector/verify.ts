import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import path from "node:path"

type Tool = { name: string; execute: (input: Record<string, unknown>) => Promise<{ content: string }> }
const tools = new Map<string, Tool>()
const loaded = await import(pathToFileURL(path.join(import.meta.dir, "plugin", "server.js")).href)
await loaded.default.setup({
  tool: {
    transform: async (register: (editor: { add: (tool: Tool) => void }) => void) =>
      register({
        add: (tool) => {
          tools.set(tool.name, tool)
        },
      }),
  },
})
assert.deepEqual([...tools.keys()], ["json_inspect", "json_pointer_get"])
const run = async (name: string, input: Record<string, unknown>) =>
  JSON.parse((await tools.get(name)!.execute(input)).content)
const json = JSON.stringify({
  customer: { name: "Ana", email: "ana@example.com" },
  orders: [{ id: "ORD-1042", total: 149.9 }],
  active: true,
})
assert.deepEqual(await run("json_inspect", { json }), {
  ok: true,
  type: "object",
  counts: { objects: 3, arrays: 1, keys: 7, values: 9 },
})
for (const [source, pointer, value] of [
  [json, "/customer/email", "ana@example.com"],
  [json, "/orders/0/total", 149.9],
  [json, "", JSON.parse(json)],
  ['{"a/b":{"~name":42}}', "/a~1b/~0name", 42],
  ['{"~1":7}', "/~01", 7],
  ['{"":null}', "/", null],
  ['{"__proto__":{"admin":false}}', "/__proto__/admin", false],
] as const) {
  assert.deepEqual((await run("json_pointer_get", { json: source, pointer })).value, value)
}
for (const [source, pointer] of [
  [json, "/customer/missing"],
  [json, "/customer/~2"],
  [json, "/customer/~"],
  [json, "/orders/01"],
  [json, "/orders/-"],
  [json, "/orders/4"],
  [json, "/customer/name/length"],
  [json, "/constructor"],
  [json, "customer"],
] as const) {
  const result = await run("json_pointer_get", { json: source, pointer })
  assert.equal(result.ok, false)
  assert.equal(typeof result.error, "string")
}
assert.equal((await run("json_inspect", { json: "{" })).ok, false)
assert.equal((await run("json_pointer_get", { json: "{", pointer: "" })).ok, false)
assert.deepEqual(await run("json_inspect", { json: "null" }), {
  ok: true,
  type: "null",
  counts: { objects: 0, arrays: 0, keys: 0, values: 1 },
})
const depth = 1000
assert.deepEqual((await run("json_inspect", { json: "[".repeat(depth) + "0" + "]".repeat(depth) })).counts, {
  objects: 0,
  arrays: depth,
  keys: 0,
  values: depth + 1,
})
console.log(
  "Passed: real exported plugin module, 22 cases (valid/invalid JSON, own keys, RFC 6901, arrays and deep input).",
)
