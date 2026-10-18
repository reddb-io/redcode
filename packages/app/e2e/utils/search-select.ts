import { expect, type Locator, type Page } from "@playwright/test"

export async function chooseSearchOption(page: Page, trigger: Locator, label: string, query = label) {
  await trigger.click()
  const search = page.getByRole("combobox", { name: "Search options", exact: true })
  await expect(search).toBeFocused()
  await search.fill(query)
  await page.getByRole("option", { name: label, exact: true }).click()
  await expect(search).toBeHidden()
  await expect(trigger).toContainText(label)
}
