import { expect, test } from "bun:test"
import { mkdir, symlink } from "node:fs/promises"
import path from "node:path"
import { DesignInventory } from "../src/design/inventory"
import { tmpdir } from "./fixture/tmpdir"

const fixture = async (root: string) => {
  const files = {
    "src/components/index.ts":
      'export { Button } from "./Button"\nexport * from "./Card"\nexport { useTheme } from "./hooks"\n',
    "src/components/Button.tsx":
      "export interface ButtonProps { label: string }\nexport function Button(props: ButtonProps) { return <button>{props.label}</button> }\nexport const buttonSizes = [1]\n",
    "src/components/Card.tsx": "export const Card = () => null\nexport type CardProps = { title: string }\n",
    "src/components/Modal.tsx": "export default function Modal() { return null }\n",
    "src/components/hooks.ts": "export const useTheme = () => null\n",
    "src/components/broken.tsx": "export const = <<<\n",
    "src/components/Button.stories.tsx": "export const Story = 1\n",
    "src/components/Button.test.tsx": "export const Fixture = 1\n",
    "src/components/__tests__/helpers.ts": "export const Helper = 1\n",
    "src/components/node_modules/dep/index.ts": "export const Dependency = 1\n",
    "src/components/types.d.ts": "export declare const Declared: number\n",
    "src/components/Huge.tsx": `export const Huge = () => null\n// ${"x".repeat(300 * 1024)}\n`,
    "packages/ui/package.json": JSON.stringify({ name: "ui", peerDependencies: { react: "^18" } }),
    "packages/ui/src/index.ts": 'export { Avatar as Face } from "./avatar"\n',
    "packages/ui/src/avatar.js": "export const Avatar = () => null\n",
    "packages/core/src/index.ts": Array.from(
      { length: 100 },
      (_, index) => `export const Service${index} = ${index}`,
    ).join("\n"),
    "packages/widgets/src/Widget.jsx": "export const Widget = () => null\n",
  }
  await Promise.all(Object.entries(files).map(([file, content]) => Bun.write(path.join(root, file), content)))
}

test("lists exported PascalCase components per root without evaluating, following or failing on odd files", async () => {
  await using tmp = await tmpdir()
  await fixture(tmp.path)
  expect(
    await DesignInventory.scan(tmp.path, ["src/components", "packages/ui/src", "src/missing", "../outside"]),
  ).toEqual([
    { root: "src/components", file: "src/components/Button.tsx", name: "Button", props: "ButtonProps" },
    { root: "src/components", file: "src/components/Card.tsx", name: "Card", props: "CardProps" },
    { root: "src/components", file: "src/components/Modal.tsx", name: "Modal" },
    { root: "packages/ui/src", file: "packages/ui/src/avatar.js", name: "Avatar" },
    { root: "packages/ui/src", file: "packages/ui/src/index.ts", name: "Face" },
  ])
})

test("treats a monorepo package as a component root only when it renders", async () => {
  await using tmp = await tmpdir()
  await fixture(tmp.path)
  const inventory = await DesignInventory.scan(tmp.path, [
    "packages/core/src",
    "packages/ui/src",
    "packages/widgets/src",
  ])
  expect(inventory.map((entry) => entry.root)).toEqual(["packages/ui/src", "packages/ui/src", "packages/widgets/src"])
  expect(inventory.at(-1)).toEqual({
    root: "packages/widgets/src",
    file: "packages/widgets/src/Widget.jsx",
    name: "Widget",
  })
})

test("skips a root that links outside the application", async () => {
  await using tmp = await tmpdir()
  const application = path.join(tmp.path, "application")
  const external = path.join(tmp.path, "external")
  await mkdir(path.join(application, "src"), { recursive: true })
  await Bun.write(path.join(external, "Secret.tsx"), "export const Secret = () => null")
  await symlink(external, path.join(application, "src", "linked"), process.platform === "win32" ? "junction" : "dir")
  expect(await DesignInventory.scan(application, ["src/linked"])).toEqual([])
})

test("bounds each root to sixty entries and the inventory to two hundred so late roots still appear", async () => {
  await using tmp = await tmpdir()
  await Promise.all([
    ...Array.from({ length: 30 }, (_, index) =>
      Bun.write(
        path.join(tmp.path, "src/components", `Group${String(index).padStart(2, "0")}.tsx`),
        Array.from({ length: 10 }, (_, entry) => `export const Item${index}x${entry} = () => null`).join("\n"),
      ),
    ),
    Bun.write(path.join(tmp.path, "src/design-system/Late.tsx"), "export const Late = () => null"),
  ])
  const inventory = await DesignInventory.scan(tmp.path, ["src/components", "src/design-system"])
  expect(inventory.filter((entry) => entry.root === "src/components")).toHaveLength(60)
  expect(inventory.at(-1)).toEqual({ root: "src/design-system", file: "src/design-system/Late.tsx", name: "Late" })
  expect(inventory[0]).toEqual({ root: "src/components", file: "src/components/Group00.tsx", name: "Item0x0" })
  await Promise.all(
    Array.from({ length: 5 }, (_, root) =>
      Bun.write(
        path.join(tmp.path, `src/root${root}/All.tsx`),
        Array.from({ length: 60 }, (_, entry) => `export const R${root}x${entry} = () => null`).join("\n"),
      ),
    ),
  )
  expect(
    await DesignInventory.scan(tmp.path, ["src/root0", "src/root1", "src/root2", "src/root3", "src/root4"]),
  ).toHaveLength(200)
})
