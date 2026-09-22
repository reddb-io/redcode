import config from "../performance/playwright.config"

export default {
  ...config,
  testDir: "..",
  testMatch: ["**/intelligence/*.spec.ts", "**/performance/timeline/first-navigation-benchmark.spec.ts"],
  outputDir: "../test-results/intelligence",
  reporter: [["html", { outputFolder: "e2e/playwright-report/intelligence", open: "never" }], ["line"]],
}
