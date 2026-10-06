import { expect, test } from "bun:test"
import { mkdir, symlink } from "node:fs/promises"
import path from "node:path"
import { DesignInventory } from "@opencode/core/design/inventory"
import { DesignSystem } from "@opencode/core/design/system"
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

test("bounds each file to sixteen names, each root to 400 entries and the inventory to 800 so late roots still appear", async () => {
  await using tmp = await tmpdir()
  await Promise.all([
    ...Array.from({ length: 30 }, (_, index) =>
      Bun.write(
        path.join(tmp.path, "src/components", `Group${String(index).padStart(2, "0")}.tsx`),
        Array.from({ length: 20 }, (_, entry) => `export const Item${index}x${entry} = () => null`).join("\n"),
      ),
    ),
    Bun.write(path.join(tmp.path, "src/design-system/Late.tsx"), "export const Late = () => null"),
  ])
  const inventory = await DesignInventory.scan(tmp.path, ["src/components", "src/design-system"])
  expect(inventory.filter((entry) => entry.file === "src/components/Group00.tsx")).toHaveLength(16)
  expect(inventory.filter((entry) => entry.root === "src/components")).toHaveLength(400)
  expect(inventory.at(-1)).toEqual({ root: "src/design-system", file: "src/design-system/Late.tsx", name: "Late" })
  expect(inventory[0]).toEqual({ root: "src/components", file: "src/components/Group00.tsx", name: "Item0x0" })
  await Promise.all(
    Array.from({ length: 3 }, (_, root) =>
      Promise.all(
        Array.from({ length: 30 }, (_, file) =>
          Bun.write(
            path.join(tmp.path, `src/root${root}/File${String(file).padStart(2, "0")}.tsx`),
            Array.from({ length: 16 }, (_, entry) => `export const R${root}f${file}x${entry} = () => null`).join("\n"),
          ),
        ),
      ),
    ),
  )
  expect(await DesignInventory.scan(tmp.path, ["src/root0", "src/root1", "src/root2"])).toHaveLength(800)
})

test("keeps a whole shadcn ui folder, primary export first, and lists it per file for the model", async () => {
  await using tmp = await tmpdir()
  const parts = ["Content", "Header", "Footer", "Title", "Description", "Trigger", "Close", "Portal", "Overlay"]
  const names = [
    "accordion", "alert", "alert-dialog", "aspect-ratio", "avatar", "badge", "breadcrumb", "button", "calendar", "card",
    "carousel", "chart", "checkbox", "collapsible", "command", "context-menu", "dialog", "drawer", "dropdown-menu", "form",
    "hover-card", "input", "input-otp", "label", "menubar", "navigation-menu", "pagination", "popover", "progress",
    "radio-group", "resizable", "scroll-area", "select", "separator", "sheet", "sidebar", "skeleton", "slider", "sonner",
    "switch", "table", "tabs", "textarea", "toast", "toggle", "toggle-group", "tooltip",
  ]
  const pascal = (name: string) => name.split("-").map((part) => part[0]!.toUpperCase() + part.slice(1)).join("")
  // Dialog, Select and Table carry all nine parts; the others between one and nine, about 280 exports in all.
  const own = (name: string, index: number) =>
    ["dialog", "select", "table"].includes(name) ? parts : parts.slice(0, (index % 9) + 1)
  await Promise.all(
    names.map((name, index) =>
      Bun.write(
        path.join(tmp.path, "src/components/ui", `${name}.tsx`),
        // shadcn lists the parts first and the primary export among them, as in its generated files.
        `${own(name, index).map((part) => `const ${pascal(name)}${part} = () => null`).join("\n")}\nconst ${pascal(name)} = () => null\nexport { ${own(name, index).map((part) => `${pascal(name)}${part}`).join(", ")}, ${pascal(name)} }\n`,
      ),
    ),
  )
  const inventory = await DesignInventory.scan(tmp.path, ["src/components/ui"])
  for (const name of ["Dialog", "Select", "Table", "Tooltip"]) expect(inventory.some((entry) => entry.name === name)).toBe(true)
  expect(inventory.find((entry) => entry.file === "src/components/ui/dialog.tsx")?.name).toBe("Dialog")
  const described = DesignSystem.describe({
    sources: [],
    inventory,
    system: { paths: ["src/components/ui"], css: [], tailwind: true, aliases: { "@/": "./src/" } },
  })
  expect(described).toContain('Components src/components/ui (import { Name } from "@/components/ui/<file>"):')
  expect(described).toContain("- dialog.tsx: Dialog; also DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, +3 more")
  expect(described).toContain("- select.tsx: Select; also SelectClose, SelectContent")
  expect(described).toContain("- table.tsx: Table; also TableClose, TableContent")
  // Past sixty files the rest are counted and pointed to, never silently dropped.
  const many = DesignSystem.describe({
    sources: [],
    inventory: Array.from({ length: 70 }, (_, index) => ({ root: "src/ui", file: `src/ui/c${index}.tsx`, name: `C${index}` })),
  })
  expect(many).toContain("- c59.tsx: C59")
  expect(many).not.toContain("- c60.tsx")
  expect(many).toContain("10 more component files not listed (70 exports in all): read the Components section of .red/DESIGN.md")
})
