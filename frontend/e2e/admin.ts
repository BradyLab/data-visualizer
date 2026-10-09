// Helpers for the admin pages
import { expect, type Locator, type Page } from '@playwright/test'

/**
 * The User Management table row with this email. The table shows 10 users a page and a long run creates many users, so this pages
 * forward until the row shows up (a user invited while the page is open lands at the end). Each step waits for the footer's
 * "1-10 of 120" text to change, so a page is never skipped before it has rendered
 */
export const userRow = async (page: Page, email: string): Promise<Locator> => {
  const row = page.getByRole('row').filter({ hasText: email })
  const footer = page.locator('.v-data-table-footer__info')
  const next = page.getByRole('button', { name: 'Next page' })
  await expect(async () => {
    for (;;) {
      if ((await row.count()) > 0) return
      if (!(await next.isEnabled())) throw new Error(`${email} is not in the table yet`)
      const before = await footer.innerText()
      await next.click()
      await expect(footer).not.toHaveText(before)
    }
  }).toPass({ timeout: 20_000 })
  return row
}

/**
 * Opens a Vuetify dropdown and picks the option with this exact text. Long lists only render the rows in view, so this scrolls the list
 * until the option exists (a plain getByRole('option') would not find rows below the fold)
 */
export const pickOption = async (page: Page, field: Locator, name: string) => {
  await field.click()
  const option = page.getByRole('option', { name, exact: true })
  // The menu of the previous dropdown can still be fading out, and the newest one is last in the page
  const list = page.getByRole('listbox').last()
  await expect(list).toBeVisible()
  // Scroll with the mouse wheel over the list, as a user would, until the option is rendered or the end of the list is reached.
  // A frame is awaited after each step so the list can render its new rows
  await list.hover()
  for (let step = 0; step < 300 && (await option.count()) === 0; step++) {
    await page.mouse.wheel(0, 300)
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  }
  await option.click()
}
