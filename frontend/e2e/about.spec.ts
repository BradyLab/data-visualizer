// The About page: everyone reads it, only admins edit it (in a Markdown editor with a live preview)
import { test, expect } from '@playwright/test'
import { login, saveAboutPage, trySaveAboutPage, uid } from './api'
import { authFile, LOGGED_OUT } from './users'

// One spec at a time edits the page, and it is put back to the default text afterwards
test.describe.configure({ mode: 'serial' })

test.afterAll(async ({ request }) => saveAboutPage(request, await login(request, 'admin'), ''))

test.describe('as an admin', () => {
  test.use({ storageState: authFile('admin') })

  test('edits the page with a live preview, saves it, and everyone then sees the new text', async ({ page, browser }) => {
    const heading = `Our story ${uid()}`
    await page.goto('/about')
    await page.getByRole('button', { name: 'Edit' }).click()
    const text = page.getByRole('textbox', { name: 'About page text (Markdown)' })
    await expect(text).toBeFocused()

    // The formatting buttons write Markdown, and the preview follows what is typed
    await text.fill(`# ${heading}\n\nWe grow **roots**.`)
    const preview = page.getByRole('region', { name: 'Preview' })
    await expect(preview.getByRole('heading', { name: heading })).toBeVisible()
    await expect(preview.locator('strong')).toHaveText('roots')
    await text.press('Control+a')
    await page.getByRole('button', { name: 'Italic' }).click()
    await expect(text).toHaveValue(`_# ${heading}\n\nWe grow **roots**._`)
    await text.fill(`# ${heading}\n\nWe grow **roots**.`)

    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('The About page was saved.')).toBeVisible()
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit' })).toBeFocused()

    // The change is in the activity log
    await page.goto('/admin/activity-logs')
    await expect(page.getByRole('row', { name: /Page Updated/ }).first()).toContainText(heading)

    // A visitor who is not logged in sees it too, without an Edit button
    const guest = await browser.newContext({ storageState: LOGGED_OUT })
    const guestPage = await guest.newPage()
    await guestPage.goto('/about')
    await expect(guestPage.getByRole('heading', { name: heading })).toBeVisible()
    await expect(guestPage.getByRole('button', { name: 'Edit' })).toHaveCount(0)
    await guest.close()
  })

  test('cancelling keeps the saved text', async ({ page }) => {
    await page.goto('/about')
    await page.getByRole('button', { name: 'Edit' }).click()
    await page.getByRole('textbox', { name: 'About page text (Markdown)' }).fill('Thrown away')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('Thrown away')).toHaveCount(0)
  })

  test('scripts in the text are not run', async ({ page }) => {
    await saveAboutPage(page.request, await login(page.request, 'admin'), '<img src="x" onerror="document.title=\'hacked\'">\n\nSafe text')
    await page.goto('/about')
    await expect(page.getByText('Safe text')).toBeVisible()
    await expect(page).not.toHaveTitle('hacked')
    await expect(page.locator('.markdown-body [onerror]')).toHaveCount(0)
  })
})

test.describe('as someone else', () => {
  test.use({ storageState: authFile('lab') })

  test('a lab member has no Edit button, and the API refuses them, external users and guests', async ({ page, request }) => {
    await page.goto('/about')
    await expect(page.getByRole('heading', { name: 'ABOUT' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0)
    expect((await trySaveAboutPage(request, await login(request, 'lab'), 'x')).status()).toBe(403)
    expect((await trySaveAboutPage(request, await login(request, 'external'), 'x')).status()).toBe(403)
    expect((await trySaveAboutPage(request, null, 'x')).status()).toBe(401)
  })
})
