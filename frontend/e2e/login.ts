// Fills in and submits the login form (the page must already be on /login)
import { expect, type Page } from '@playwright/test'
import { waitForDatasetList } from './api'
import { E2E_PASSWORD } from './users'

export const submitLogin = async (page: Page, email: string, password = E2E_PASSWORD) => {
  // Vuetify adds a "Clear ..." button with a matching aria-label, so the email field is found by role instead of getByLabel
  await page.getByRole('textbox', { name: 'Email Address' }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Log In' }).click()
}

/** Logs in through the form and waits until the page is on /home with its live-update websocket connected (so server pushes are not missed) */
export const loginLive = async (page: Page, email: string, password: string) => {
  await page.goto('/login')
  const socket = page.waitForEvent('websocket', (ws) => ws.url().includes('/socket.io'))
  // Logging in makes the app load the dataset list again; a push that lands before it arrives could be overwritten by it
  const list = waitForDatasetList(page)
  await submitLogin(page, email, password)
  await expect(page).toHaveURL(/\/home$/)
  await socket
  await list
}

/** The app has dropped the page's saved login (what it does when the server ends the session); the page itself stays where it is */
export const expectLoggedOut = (page: Page) =>
  expect.poll(() => page.evaluate(() => localStorage.getItem('token')), { message: 'saved login token' }).toBeNull()
