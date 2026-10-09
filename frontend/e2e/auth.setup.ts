// Runs once before the tests (the "setup" project): logs in as each test user through the real login form and saves the session,
// so the specs start already logged in. Specs that exercise the login form itself use LOGGED_OUT instead
import { test as setup, expect } from '@playwright/test'
import { submitLogin } from './login'
import { authFile, USERS, type Role } from './users'

for (const role of Object.keys(USERS) as Role[]) {
  setup(`log in as ${role}`, async ({ page }) => {
    await page.goto('/login')
    await submitLogin(page, USERS[role].email)
    await expect(page).toHaveURL(/\/home$/)
    await page.context().storageState({ path: authFile(role) })
  })
}
