import { expect, test } from "bun:test"
import { mkdir, mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DesktopWindows } from "../src/services/desktop-windows"

test("desktop payload retains native search and its notices, while older releases remain installable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "redcode-desktop-search-"))
  const source = path.join(root, "archive")
  const target = path.join(root, "installed")
  await mkdir(source)
  await mkdir(target)
  await DesktopWindows.copyPathSearch(source, target)
  expect(await Bun.file(path.join(target, "redcode_path_search.dll")).exists()).toBe(false)
  for (const name of ["redcode_path_search.dll", "LICENSE.nucleo-matcher.txt", "THIRD_PARTY_NOTICES.txt"])
    await Bun.write(path.join(source, name), name)
  await DesktopWindows.copyPathSearch(source, target)
  for (const name of ["redcode_path_search.dll", "LICENSE.nucleo-matcher.txt", "THIRD_PARTY_NOTICES.txt"])
    expect(await Bun.file(path.join(target, name)).text()).toBe(name)
})
