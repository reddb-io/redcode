import { expect, test } from "bun:test"
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
    "packages/ui/src/index.ts": 'export { Avatar as Face } from "./avatar"\n',
    "packages/ui/src/avatar.js": "export const Avatar = () => null\n",
  }
  await Promise.all(Object.entries(files).map(([file, content]) => Bun.write(path.join(root, file), content)))
}

test("lists exported PascalCase components per root without evaluating or following broken files", async () => {
  await using tmp = await tmpdir()
  await fixture(tmp.path)
  expect(await DesignInventory.scan(tmp.path, ["src/components", "packages/ui/src", "src/missing"])).toEqual([
    { root: "src/components", file: "src/components/Button.tsx", name: "Button", props: "ButtonProps" },
    { root: "src/components", file: "src/components/Card.tsx", name: "Card", props: "CardProps" },
    { root: "src/components", file: "src/components/Modal.tsx", name: "Modal" },
    { root: "packages/ui/src", file: "packages/ui/src/avatar.js", name: "Avatar" },
    { root: "packages/ui/src", file: "packages/ui/src/index.ts", name: "Face" },
  ])
})

test("bounds the inventory to two hundred entries", async () => {
  await using tmp = await tmpdir()
  await Promise.all(
    Array.from({ length: 30 }, (_, index) =>
      Bun.write(
        path.join(tmp.path, "src/components", `Group${String(index).padStart(2, "0")}.tsx`),
        Array.from({ length: 10 }, (_, entry) => `export const Item${index}x${entry} = () => null`).join("\n"),
      ),
    ),
  )
  const inventory = await DesignInventory.scan(tmp.path, ["src/components"])
  expect(inventory).toHaveLength(200)
  expect(inventory[0]).toEqual({ root: "src/components", file: "src/components/Group00.tsx", name: "Item0x0" })
})
