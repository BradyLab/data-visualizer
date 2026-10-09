// Smoke tests: the app boots, login works, and route guards send people to the right place
import { test, expect } from '@playwright/test'
import { resetRateLimits } from './db'
import { submitLogin } from './login'
import { authFile, LOGGED_OUT, USERS } from './users'

test.describe('logged out', () => {
  test.use({ storageState: LOGGED_OUT })

  // The wrong-password test fails a login on purpose, which counts toward the address's limit
  test.afterEach(resetRateLimits)

  test('a protected page redirects to login and returns there after logging in', async ({ page }) => {
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/login\?redirect=\/settings/)
    await submitLogin(page, USERS.lab.email)
    await expect(page).toHaveURL(/\/settings$/)
  })

  test('a wrong password shows an error and stays on the login page', async ({ page }) => {
    await page.goto('/login')
    // An address no account uses: failed logins count against the account's limit (5 per 15 minutes), which would lock out the real users
    await submitLogin(page, 'nobody@e2e.test', 'not-the-password')
    await expect(page.getByText('Invalid email or password')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('as a lab member', () => {
  test.use({ storageState: authFile('lab') })

  test('stays logged in across a reload', async ({ page }) => {
    await page.goto('/home')
    await page.reload()
    await expect(page).toHaveURL(/\/home$/)
  })

  test('is sent home from admin pages', async ({ page }) => {
    await page.goto('/admin/user-mgmt')
    await expect(page).toHaveURL(/\/home$/)
  })
})

test.describe('as an admin', () => {
  test.use({ storageState: authFile('admin') })

  test('can open admin pages', async ({ page }) => {
    await page.goto('/admin/user-mgmt')
    await expect(page).toHaveURL(/\/admin\/user-mgmt$/)
  })
})
