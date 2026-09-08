import { expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { LSPClient } from "@/lsp/client"
import { spawn } from "@/lsp/launch"
import { Process } from "@/util/process"
import { tmpdir, withTestInstance } from "../fixture/fixture"

test.each(["true", "text", "false", "omitted"])("saved changes honor LSP save capability: %s", async (save) => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "lib.rs")
  await Bun.write(file, 'pub fn value() -> u32 { "wrong" }\n')

  await withTestInstance({
    directory: tmp.path,
    fn: async (ctx) => {
      const handle = {
        process: spawn(process.execPath, [path.join(import.meta.dir, "../fixture/lsp/fake-lsp-server.js")], {
          env: { FAKE_LSP_SAVE: save },
        }),
      }
      const client = await LSPClient.create({
        serverID: "rust",
        server: handle,
        root: tmp.path,
        directory: tmp.path,
        instance: ctx,
      }).catch(async (error) => {
        await Process.stop(handle.process)
        throw error
      })
      try {
        const initialized = await client.connection.sendRequest<{
          capabilities: { textDocument: { synchronization: { didSave?: boolean } } }
        }>("test/get-initialize-params", {})
        expect(initialized.capabilities.textDocument.synchronization.didSave).toBe(true)
        await client.notify.open({ path: file })
        await client.notify.open({ path: file })
        expect(await client.connection.sendRequest("test/get-last-save", {})).toBeNull()

        const text = "pub fn value() -> u32 { 42 }\n"
        await Bun.write(file, text)
        await client.notify.open({ path: file })
        expect(await client.connection.sendRequest<unknown>("test/get-last-save", {})).toEqual(
          save === "false" || save === "omitted"
            ? null
            : { textDocument: { uri: pathToFileURL(file).href }, ...(save === "text" ? { text } : {}) },
        )
      } finally {
        await client.shutdown()
      }
    },
  })
})
