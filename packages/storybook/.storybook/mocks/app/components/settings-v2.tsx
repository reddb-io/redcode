// Stories never open the settings dialog, but the composer reaches it through a dynamic import, and
// the bundler still resolves that whole settings tree against the context mocks. Stub the entry.
export function DialogSettings() {
  return null
}
