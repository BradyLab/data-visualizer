// A user's life: invited, first login with a forced password change, then deactivated or deleted by an admin while logged in
import { test, expect } from '@playwright/test'
import { UserRoles, UserStatus } from '@commons/user'
import {
  activeUser,
  changePassword,
  createDataset,
  deleteUser,
  DEFAULT_PASSWORD,
  inviteUser,
  login,
  tryLogin,
  updateUser,
} from './api'
import { resetRateLimits } from './db'
import { userRow } from './admin'
import { expectLoggedOut, loginLive, submitLogin } from './login'
import { BACKEND_URL } from './stack'
import { authFile, LOGGED_OUT } from './users'

test.describe('first login', () => {
  test.use({ storageState: LOGGED_OUT })

  // Both tests check that a refused password fails to log in, which counts toward the address's limit
  test.afterEach(resetRateLimits)

  test('an invited user must replace the default password, then is active', async ({ page, request }) => {
    const admin = await login(request, 'admin')
    const invited = await inviteUser(request, admin, UserRoles.EXTERNAL)

    await page.goto('/login')
    await submitLogin(page, invited.email, DEFAULT_PASSWORD)
    // Invited users are sent to settings, where the change-password dialog cannot be dismissed
    await expect(page).toHaveURL(/\/settings$/)
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Change Password')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveCount(0)

    // The default password cannot be kept as the "new" one, and the new one must be long enough
    await dialog.getByLabel('Old password').fill(DEFAULT_PASSWORD)
    await dialog.getByLabel('New password', { exact: true }).fill('short')
    await dialog.getByLabel('Confirm new password').fill('short')
    await dialog.getByRole('button', { name: 'Change' }).click()
    await expect(dialog.getByText(/at least 8 characters/i)).toBeVisible()

    const newPassword = 'a-Brand-new-pw-1'
    await dialog.getByLabel('New password', { exact: true }).fill(newPassword)
    await dialog.getByLabel('Confirm new password').fill(newPassword)
    await dialog.getByRole('button', { name: 'Change' }).click()
    await expect(dialog.getByText('Password updated.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Close' }).click()

    // Now active: the whole app opens, and only the new password works
    await page.goto('/home')
    await expect(page).toHaveURL(/\/home$/)
    expect((await tryLogin(request, invited.email, newPassword)).status()).toBe(200)
    expect((await tryLogin(request, invited.email, DEFAULT_PASSWORD)).status()).toBe(401)
    const me = await (await tryLogin(request, invited.email, newPassword)).json()
    expect(me.user.status).toBe(UserStatus.ACTIVE)
  })

  test('changing the password logs out the same account\'s other sessions', async ({ browser, request }) => {
    const admin = await login(request, 'admin')
    const user = await activeUser(request, admin, UserRoles.EXTERNAL)
    const other = await browser.newContext({ storageState: LOGGED_OUT })
    const page = await other.newPage()
    await loginLive(page, user.email, user.password)

    await changePassword(request, user, `Changed-${Date.now()}-pw`)
    await expectLoggedOut(page)
    // ...so a protected page now sends them to the login form
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/login/)
    await other.close()
  })
})

test.describe('admin actions on a logged-in user', () => {
  test.use({ storageState: LOGGED_OUT })

  test.afterEach(resetRateLimits)

  test('deactivating a user in the admin page ends their open session and blocks login', async ({ browser, request }) => {
    const admin = await login(request, 'admin')
    const user = await activeUser(request, admin, UserRoles.EXTERNAL, `Deactivate ${Date.now()}`)

    // The user is logged in and looking at the app
    const userContext = await browser.newContext({ storageState: LOGGED_OUT })
    const userPage = await userContext.newPage()
    await loginLive(userPage, user.email, user.password)

    // The admin deactivates them through the Edit dialog
    const adminContext = await browser.newContext({ storageState: authFile('admin') })
    const adminPage = await adminContext.newPage()
    await adminPage.goto('/admin/user-mgmt')
    const row = await userRow(adminPage, user.email)
    await row.getByRole('button', { name: 'Edit' }).click()
    const dialog = adminPage.getByRole('dialog')
    await dialog.locator('.v-field', { hasText: 'Status' }).click()
    await adminPage.getByRole('option', { name: 'INACTIVE' }).click()
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(row.getByText('INACTIVE')).toBeVisible()

    // Their open page is logged out without a reload (it stays where it is: public pages work for guests), and they cannot log back in
    await expectLoggedOut(userPage)
    expect((await tryLogin(request, user.email, user.password)).status()).toBe(401)
    await userContext.close()
    await adminContext.close()
  })

  test('deleting a user ends their open session', async ({ browser, request }) => {
    const admin = await login(request, 'admin')
    const user = await activeUser(request, admin, UserRoles.EXTERNAL)
    const context = await browser.newContext({ storageState: LOGGED_OUT })
    const page = await context.newPage()
    await loginLive(page, user.email, user.password)

    expect((await deleteUser(request, admin, user.user.id)).status()).toBe(204)
    await expectLoggedOut(page)
    await context.close()
  })
})

test.describe('rules that protect the data', () => {
  test('the last active admin cannot be deactivated, demoted or deleted', async ({ request }) => {
    const admin = await login(request, 'admin')
    expect((await updateUser(request, admin, admin.user.id, { status: UserStatus.INACTIVE })).status()).toBe(409)
    expect((await updateUser(request, admin, admin.user.id, { role: UserRoles.EXTERNAL })).status()).toBe(409)
    expect((await deleteUser(request, admin, admin.user.id)).status()).toBe(409)
  })

  test('a user who owns datasets cannot be deleted', async ({ request }) => {
    const admin = await login(request, 'admin')
    const owner = await activeUser(request, admin, UserRoles.LAB_MEMBER)
    await createDataset(request, owner)
    expect((await deleteUser(request, admin, owner.user.id)).status()).toBe(409)
  })

  test('non-admins cannot manage users, and users may only rename themselves', async ({ request }) => {
    const admin = await login(request, 'admin')
    const user = await activeUser(request, admin, UserRoles.LAB_MEMBER)
    const headers = { Authorization: `Bearer ${user.token}` }
    expect((await request.get(`${BACKEND_URL}/api/users`, { headers })).status()).toBe(403)
    expect((await updateUser(request, user, user.user.id, { role: UserRoles.ADMIN })).status()).toBe(403)
    expect((await updateUser(request, user, user.user.id, { name: 'Renamed myself' })).status()).toBe(200)
  })
})
