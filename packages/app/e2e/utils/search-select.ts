import { expect, type Locator, type Page } from "@playwright/test"

export async function chooseSearchOption(page: Page, trigger: Locator, label: string, query = label) {
  await trigger.click()
  const search = page.getByRole("dialog").getByRole("combobox")
  await expect(search).toBeFocused()
  await search.fill(query)
  await page
    .getByRole("option", { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`) })
    .click()
  await expect(search).toBeHidden()
  await expect(trigger).toContainText(label)
}
