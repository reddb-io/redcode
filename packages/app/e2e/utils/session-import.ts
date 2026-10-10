import type { Page } from "@playwright/test"
import type { SessionImport } from "@opencode/schema/session-import"
import type { MockAnswer } from "./mock-server"

type Summary = Omit<SessionImport.Summary, "time"> & { time: { created: number; updated: number } }

// Other agents' local histories, served by the same experimental API as the production server.
export async function mockForeignSessions(
  page: Page,
  input: {
    sources: SessionImport.SourceInfo[]
    sessions: Summary[]
    imported?: MockAnswer
  },
) {
  const listed: URL[] = []
  await page.route("**/api/experimental/session/import/sources", (route) =>
    route.fulfill({ json: { data: input.sources } }),
  )
  await page.route("**/api/experimental/session/import/sessions?*", (route) => {
    const url = new URL(route.request().url())
    listed.push(url)

    return route.fulfill({
      json: {
        data: input.sessions.filter(
          (session) =>
            session.source === url.searchParams.get("source") &&
            (!url.searchParams.has("directory") || session.directory === url.searchParams.get("directory")),
        ),
      },
    })
  })
  await page.route("**/api/experimental/session/import/foreign", (route) =>
    route.fulfill({ status: input.imported?.status ?? 501, json: input.imported?.body ?? { name: "MockUnsupported" } }),
  )

  return { listed }
}
