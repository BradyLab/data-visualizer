// Automated accessibility checks (axe, WCAG 2.2 A and AA rules) on every page and on the popups. Axe finds roughly a third of the possible
// problems (missing names, contrast, ARIA misuse); keyboard order and screen-reader wording still need a person
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createDataset, login } from './api'
import { authFile, LOGGED_OUT } from './users'

// Reduced motion makes the menus and messages appear at once (see a11y.css), so axe does not scan them half faded in and report false contrast failures
test.use({ reducedMotion: 'reduce' })

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

/** Fails with the rule, the elements and the fix hint of every violation found on the page as it is now */
const expectAccessible = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  expect(
    violations.map((v) => ({ rule: v.id, impact: v.impact, help: v.help, targets: v.nodes.map((n) => n.target.join(' ')) })),
    'axe violations'
  ).toEqual([])
}

/** Waits for the page's heading, so the scan does not run on the loading state */
const open = async (page: Page, url: string) => {
  await page.goto(url)
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
}

test.describe('logged out', () => {
  test.use({ storageState: LOGGED_OUT })

  test('home page', async ({ page }) => {
    await open(page, '/home')
    await expectAccessible(page)
  })

  test('login page', async ({ page }) => {
    await open(page, '/login')
    await expectAccessible(page)
  })

  test('login page with validation errors', async ({ page }) => {
    await open(page, '/login')
    await page.getByRole('button', { name: 'Log In' }).click()
    await expect(page.getByText('Email address is required')).toBeVisible()
    await expectAccessible(page)
  })

  test('404 page', async ({ page }) => {
    await open(page, '/no-such-page')
    await expectAccessible(page)
  })
})

test.describe('as an admin', () => {
  test.use({ storageState: authFile('admin') })

  test('the skip link moves focus to the main content', async ({ page }) => {
    await open(page, '/home')
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Skip to main content' })
    await expect(skip).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#main')).toBeFocused()
  })

  test('each page has its own title', async ({ page }) => {
    await open(page, '/settings')
    await expect(page).toHaveTitle('Settings | Brady Lab Datasets')
    await open(page, '/admin/user-mgmt')
    await expect(page).toHaveTitle('User Management | Brady Lab Datasets')
  })

  for (const [name, url] of [
    ['settings', '/settings'],
    ['user management', '/admin/user-mgmt'],
    ['permissions management', '/admin/permissions'],
    ['activity logs', '/admin/activity-logs'],
    ['new dataset form', '/dataset/new'],
  ] as const) {
    test(`${name} page`, async ({ page }) => {
      await open(page, url)
      await expectAccessible(page)
    })
  }

  test('dataset page and edit form', async ({ page, request }) => {
    const admin = await login(request, 'admin')
    const dataset = await createDataset(request, admin, { description: 'An accessibility check dataset' })
    await open(page, `/dataset/${dataset.url}`)
    await expectAccessible(page)
    await open(page, `/dataset/${dataset.url}/edit`)
    await expectAccessible(page)
  })

  test('the account menu and the dataset menu can be opened with the keyboard', async ({ page }) => {
    await open(page, '/home')
    await page.getByRole('button', { name: 'Account menu' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('listitem').or(page.getByRole('option')).filter({ hasText: 'SETTINGS' })).toBeVisible()
    await expectAccessible(page)
  })

  test('the popups', async ({ page }) => {
    await open(page, '/admin/user-mgmt')
    await page.getByRole('button', { name: 'Invite User' }).click()
    await expect(page.getByRole('dialog', { name: 'Invite User' })).toBeVisible()
    await expectAccessible(page)
    // An empty submit puts the error messages on screen, which must be readable on the dialog's dark background
    await page.getByRole('dialog').getByRole('button', { name: 'Invite' }).click()
    await expect(page.getByText('Name is required')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Name' })).toBeFocused()
    await expectAccessible(page)
    await page.keyboard.press('Escape')

    await open(page, '/admin/permissions')
    await page.getByRole('button', { name: 'New Permission' }).click()
    await expect(page.getByRole('dialog', { name: 'New Permission' })).toBeVisible()
    await expectAccessible(page)
  })
})
