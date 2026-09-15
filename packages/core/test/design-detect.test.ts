import { expect, test } from "bun:test"
import path from "node:path"
import { symlink } from "node:fs/promises"
import { DesignDetect } from "../src/design/detect"
import { tmpdir } from "./fixture/tmpdir"

const write = async (root: string, files: Record<string, string | object>) => {
  for (const [file, content] of Object.entries(files))
    await Bun.write(path.join(root, file), typeof content === "string" ? content : JSON.stringify(content, null, 2))
}
const component = (name: string) => `export function ${name}() { return <div>${name}</div> }\n`

test("a shadcn app proposes its components.json roots, stylesheet and Tailwind v3 config", async () => {
  await using tmp = await tmpdir()
  await write(tmp.path, {
    "package.json": {
      dependencies: { next: "15.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      devDependencies: { tailwindcss: "^3.4.1" },
    },
    "components.json": {
      style: "new-york",
      tailwind: { config: "tailwind.config.ts", css: "src/app/globals.css" },
      aliases: { components: "@/components", ui: "@/components/ui" },
    },
    // tsconfig.json is JSONC: comments must not defeat the static read.
    "tsconfig.json": `{\n  // shadcn alias\n  "compilerOptions": { "paths": { "@/*": ["./src/*"] } },\n}\n`,
    "tailwind.config.ts": "throw new Error('detection must never execute project code')\n",
    "src/app/globals.css": "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n",
    "src/app/page.tsx": component("Page"),
    "src/components/ui/button.tsx": component("Button"),
  })
  const proposal = await DesignDetect.detect(tmp.path)
  expect(proposal?.application).toBe(".")
  expect(proposal?.system).toEqual({
    paths: ["src/components"],
    css: ["src/app/globals.css"],
    tailwind: true,
    framework: "react",
  })
  expect(proposal?.tailwind).toEqual({ version: 3, config: "tailwind.config.ts" })
  expect(proposal?.fields.paths.confidence).toBe(0.95)
  expect(proposal?.fields.paths.evidence).toContain("components.json aliases.components @/components → src/components")
  expect(proposal?.fields.css.evidence[0]).toBe("components.json tailwind.css names src/app/globals.css")
  expect(proposal?.fields.aliases.evidence).toContain("tsconfig.json: @ → src")
  expect(proposal!.confidence).toBeGreaterThan(0.9)
  expect(DesignDetect.summary(proposal!)).toContain("Tailwind: yes (v3), tailwind.config.ts (95%)")
})

test("a Vite app on Tailwind v3 proposes the tsconfig.app.json aliases the preview build would not read", async () => {
  await using tmp = await tmpdir()
  await write(tmp.path, {
    "package.json": {
      dependencies: { react: "^18.3.1", "react-dom": "^18.3.1" },
      devDependencies: { vite: "^5.4.0", tailwindcss: "3.4.17", postcss: "^8", autoprefixer: "^10" },
    },
    "index.html": "<div id=root></div>",
    "tailwind.config.js": "module.exports = {}\n",
    "tsconfig.json": { files: [], references: [{ path: "./tsconfig.app.json" }] },
    "tsconfig.app.json": { compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } },
    "src/index.css": "@tailwind base;\n@tailwind utilities;\n",
    "src/components/Button.tsx": component("Button"),
  })
  const proposal = await DesignDetect.detect(tmp.path)
  expect(proposal?.system).toEqual({
    paths: ["src/components"],
    css: ["src/index.css"],
    tailwind: true,
    framework: "react",
    aliases: { "@": "src" },
  })
  expect(proposal?.tailwind).toEqual({ version: 3, config: "tailwind.config.js" })
  expect(proposal?.fields.application.evidence).toEqual(["single package: package.json declares a UI framework"])
})

test("a Tailwind v4 app with CSS-first configuration needs no tailwind.config", async () => {
  await using tmp = await tmpdir()
  await write(tmp.path, {
    "package.json": {
      dependencies: { react: "^19.0.0" },
      devDependencies: { vite: "^6", tailwindcss: "^4.1.0", "@tailwindcss/vite": "^4.1.0" },
    },
    "src/styles.css": '@import "tailwindcss";\n@theme { --color-brand: oklch(0.6 0.2 30); }\n',
    "src/components/Card.tsx": component("Card"),
  })
  const proposal = await DesignDetect.detect(tmp.path)
  expect(proposal?.system).toEqual({
    paths: ["src/components"],
    css: ["src/styles.css"],
    tailwind: true,
    framework: "react",
  })
  expect(proposal?.tailwind).toEqual({ version: 4 })
  expect(proposal?.fields.tailwind.evidence).toContain("CSS-first configuration in src/styles.css")
  expect(DesignDetect.summary(proposal!)).toContain("Tailwind: yes (v4, CSS-first)")
})

test("plain CSS modules propose the component root and the custom-property stylesheet without Tailwind", async () => {
  await using tmp = await tmpdir()
  await write(tmp.path, {
    "package.json": { dependencies: { "solid-js": "^1.9.0" }, devDependencies: { "vite-plugin-solid": "^2" } },
    "src/index.css": ":root {\n  --brand: #0a7;\n}\n",
    "src/components/Button.tsx": component("Button"),
    "src/components/Button.module.css": ".button { color: var(--brand); }\n",
  })
  const proposal = await DesignDetect.detect(tmp.path)
  expect(proposal?.system).toEqual({
    paths: ["src/components"],
    css: ["src/index.css"],
    tailwind: false,
    framework: "solid",
  })
  expect(proposal?.fields.tailwind).toEqual({ confidence: 0.9, evidence: ["no tailwindcss dependency"] })
  expect(proposal?.fields.css.evidence).toEqual(["src/index.css defines CSS custom properties on :root"])
})

test("a monorepo targets the application package, not the repository root or its UI library", async () => {
  await using tmp = await tmpdir()
  await write(tmp.path, {
    "package.json": { private: true, workspaces: ["apps/*", "packages/*"], devDependencies: { turbo: "^2" } },
    "apps/web/package.json": {
      dependencies: { next: "15.0.0", react: "^19.0.0", "@acme/ui": "workspace:*", tailwindcss: "^3.4.0" },
    },
    "apps/web/tailwind.config.ts": "export default {}\n",
    "apps/web/src/app/globals.css": "@tailwind base;\n",
    "apps/web/src/components/Header.tsx": component("Header"),
    "packages/ui/package.json": { name: "@acme/ui", peerDependencies: { react: "^19.0.0" } },
    "packages/ui/src/button.tsx": component("Button"),
  })
  const proposal = await DesignDetect.detect(tmp.path)
  expect(proposal?.application).toBe("apps/web")
  expect(proposal?.system).toEqual({
    paths: ["src/components"],
    css: ["src/app/globals.css"],
    tailwind: true,
    framework: "react",
  })
  expect(proposal?.fields.application.confidence).toBe(0.85)
  expect(proposal?.fields.application.evidence.join("\n")).toContain("apps/web is an application (next, src/app)")
  expect(proposal?.fields.paths.evidence.join("\n")).toContain(
    "packages/ui/src is a workspace package outside apps/web",
  )
  expect(DesignDetect.summary(proposal!)).toContain("Application: apps/web (85%)")
})

test("a single package that only exposes packages/ui/src proposes that root", async () => {
  await using tmp = await tmpdir()
  await write(tmp.path, {
    "package.json": { dependencies: { react: "^18.0.0" } },
    "packages/ui/src/Button.tsx": component("Button"),
  })
  expect((await DesignDetect.detect(tmp.path))?.system.paths).toEqual(["packages/ui/src"])
})

test("detection never reads through a path that leaves the project or the application", async () => {
  await using tmp = await tmpdir()
  await using outside = await tmpdir()
  await write(outside.path, {
    "package.json": { dependencies: { react: "^19.0.0" } },
    "src/components/Secret.tsx": component("Secret"),
    "src/index.css": ":root { --secret: red; }\n",
    "lib/Button.tsx": component("Button"),
  })
  await write(tmp.path, {
    "package.json": { dependencies: { react: "^19.0.0" } },
    "src/components/Button.tsx": component("Button"),
    "tsconfig.app.json": { compilerOptions: { paths: { "@lib/*": ["linked-lib/*"], "@src/*": ["src/*"] } } },
  })
  await symlink(path.join(outside.path, "lib"), path.join(tmp.path, "linked-lib"), "dir")
  await symlink(outside.path, path.join(tmp.path, "escape"), "dir")

  // Named applications: a `..` escape, an absolute path and a symlink to another tree all fail.
  expect(await DesignDetect.detect(tmp.path, { application: "../outside" })).toBeUndefined()
  expect(await DesignDetect.detect(tmp.path, { application: outside.path })).toBeUndefined()
  expect(await DesignDetect.detect(tmp.path, { application: "escape" })).toBeUndefined()
  expect(await DesignDetect.contained(tmp.path, "escape")).toBeUndefined()
  expect(await DesignDetect.contained(tmp.path, "./src/")).toBe("src")

  const proposal = await DesignDetect.detect(tmp.path)
  expect(proposal?.system.aliases).toEqual({ "@src": "src" })
  expect(proposal?.fields.aliases.evidence).toContain(
    "tsconfig.app.json: @lib → linked-lib is missing or leaves the application; not proposed",
  )

  // A symlinked parent directory is caught even though the last component is a real directory.
  await using linked = await tmpdir()
  await write(linked.path, { "package.json": { dependencies: { react: "^19.0.0" } } })
  await symlink(path.join(outside.path, "src"), path.join(linked.path, "src"), "dir")
  expect(await DesignDetect.detect(linked.path)).toBeUndefined()
})

test("an opened directory that is itself an application wins over workspace packages", async () => {
  await using tmp = await tmpdir()
  await write(tmp.path, {
    "package.json": { workspaces: ["apps/*"], dependencies: { next: "15.0.0", react: "^19.0.0" } },
    "app/page.tsx": component("Page"),
    "src/components/Header.tsx": component("Header"),
    "apps/docs/package.json": { dependencies: { next: "15.0.0", react: "^19.0.0" } },
    "apps/docs/src/components/Doc.tsx": component("Doc"),
  })
  const proposal = await DesignDetect.detect(tmp.path)
  expect(proposal?.application).toBe(".")
  expect(proposal?.fields.application.evidence[0]).toStartWith("the opened directory is itself an application")
})

test("workspace globs never pick packages under node_modules or dot directories", async () => {
  await using tmp = await tmpdir()
  const app = { dependencies: { next: "15.0.0", react: "^19.0.0", tailwindcss: "^3" } }
  await write(tmp.path, {
    "package.json": { workspaces: ["packages/**"] },
    "packages/node_modules/fake/package.json": app,
    "packages/node_modules/fake/app/page.tsx": component("Fake"),
    "packages/.cache/hidden/package.json": app,
    "packages/.cache/hidden/app/page.tsx": component("Hidden"),
    "packages/site/package.json": { dependencies: { react: "^19.0.0" } },
    "packages/site/src/components/Site.tsx": component("Site"),
  })
  const proposal = await DesignDetect.detect(tmp.path)
  expect(proposal?.application).toBe("packages/site")
  expect(proposal?.fields.application.evidence[0]).toBe("monorepo with 1 workspace package (packages/**)")
})

test("a project without a design system proposes nothing", async () => {
  await using tmp = await tmpdir()
  await write(tmp.path, { "package.json": { dependencies: { express: "^4" } }, "src/index.ts": "export {}\n" })
  expect(await DesignDetect.detect(tmp.path)).toBeUndefined()
  await using empty = await tmpdir()
  expect(await DesignDetect.detect(empty.path)).toBeUndefined()
})
