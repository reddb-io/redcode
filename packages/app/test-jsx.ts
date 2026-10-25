import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const solid = createRequire(require.resolve("vite-plugin-solid"))
const { transformSync } = solid("@babel/core")

// Bun cannot compile Solid JSX. Match Vite's Solid/React file boundary so tests
// can import the real mixed-renderer production modules.
Bun.plugin({
  name: "app-test-solid",
  setup(build) {
    build.onLoad(
      { filter: /[\\/]packages[\\/](?:app|ui|session-ui|gui-extensions)[\\/]src[\\/].*\.tsx$/ },
      async (args) => {
        const text = await Bun.file(args.path).text()
        if (args.path.endsWith(".react.tsx") || /@jsxImportSource\s+react\b/.test(text))
          return { contents: text, loader: "tsx" }
        return {
          contents: transformSync(text, {
            filename: args.path,
            presets: [solid.resolve("babel-preset-solid"), solid.resolve("@babel/preset-typescript")],
          }).code,
          loader: "js",
        }
      },
    )
  },
})
