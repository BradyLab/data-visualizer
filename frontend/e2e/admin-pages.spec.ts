// The management pages: users, permissions, activity logs, and the settings page
import { test, expect } from '@playwright/test'
import { DatasetVisibility } from '@commons/dataset'
import { PermissionOptions } from '@commons/permissions'
import { UserRoles } from '@commons/user'
import {
  activeUser,
  createDataset,
  getDataset,
  getPermission,
  grant,
  gotoLive,
  inviteUser,
  login,
  uid,
} from './api'
import { pickOption, userRow } from './admin'
import { submitLogin } from './login'
import { authFile, LOGGED_OUT } from './users'

test.describe('user management', () => {
  test.use({ storageState: authFile('admin') })

  test('invites a user from the dialog, and rejects a duplicate email', async ({ page }) => {
    const name = `Invited ${uid()}`
    const email = `ui-${uid()}@e2e.test`
    await page.goto('/admin/user-mgmt')
    await page.getByRole('button', { name: 'Invite User' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox', { name: 'Name' }).fill(name)
    await dialog.getByRole('textbox', { name: 'Email' }).fill(email)
    await dialog.getByRole('button', { name: 'Invite' }).click()
    await expect(dialog).toBeHidden()
    const row = await userRow(page, email)
    await expect(row).toContainText(name)
    await expect(row).toContainText('INVITED')

    // The same address again is refused, whatever its case
    await page.getByRole('button', { name: 'Invite User' }).click()
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Duplicate')
    await dialog.getByRole('textbox', { name: 'Email' }).fill(email.toUpperCase())
    await dialog.getByRole('button', { name: 'Invite' }).click()
    await expect(dialog.getByText('A user with that email already exists.')).toBeVisible()
  })

  // The server announces a new user over the websocket before it answers the invite request, so the store must not add it twice
  test('an invited user is listed once', async ({ page }) => {
    const email = `ui-${uid()}@e2e.test`
    await page.goto('/admin/user-mgmt')
    await page.getByRole('button', { name: 'Invite User' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Listed once')
    await dialog.getByRole('textbox', { name: 'Email' }).fill(email)
    await dialog.getByRole('button', { name: 'Invite' }).click()
    await expect(dialog).toBeHidden()
    // The table is paged and the new user lands on a later page once there are enough users, so go to the row first
    await expect(await userRow(page, email)).toHaveCount(1)
  })

  test('validates the invite form', async ({ page }) => {
    await page.goto('/admin/user-mgmt')
    await page.getByRole('button', { name: 'Invite User' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox', { name: 'Email' }).fill('not-an-email')
    await dialog.getByRole('button', { name: 'Invite' }).click()
    await expect(dialog.getByText('Name is required')).toBeVisible()
    await expect(dialog.getByText(/valid email/i)).toBeVisible()
  })

  test('a user invited elsewhere appears in the open table, and the row buttons open the filtered pages', async ({ page, request }) => {
    await gotoLive(page, '/admin/user-mgmt')
    const user = await inviteUser(request, await login(request, 'admin'), UserRoles.LAB_MEMBER)
    const row = await userRow(page, user.email)

    await row.getByRole('button', { name: 'Permissions' }).click()
    await expect(page).toHaveURL(new RegExp(`/admin/permissions\\?user=${user.user.id}`))
    await page.goBack()
    await (await userRow(page, user.email)).getByRole('button', { name: 'Activity Logs' }).click()
    await expect(page).toHaveURL(new RegExp(`/admin/activity-logs\\?user=${user.user.id}`))
  })
})

test.describe('activity logs', () => {
  test.use({ storageState: authFile('admin') })

  test('new activity appears live, and the user filter shows only that user', async ({ page, request }) => {
    const admin = await login(request, 'admin')
    const worker = await activeUser(request, admin, UserRoles.LAB_MEMBER, `Logger ${uid()}`)
    await gotoLive(page, '/admin/activity-logs')
    await expect(page.getByRole('heading', { name: 'ACTIVITY LOGS' })).toBeVisible()

    const dataset = await createDataset(request, worker)
    const row = page.getByRole('row', { name: new RegExp(dataset.name) })
    await expect(row).toContainText('Dataset Created')
    await expect(row).toContainText(worker.user.name)

    // Preset from the User Management buttons: only this user's rows
    await page.goto(`/admin/activity-logs?user=${worker.user.id}`)
    await expect(page.getByText(`User: ${worker.user.name}`)).toBeVisible()
    await expect(page.getByRole('row', { name: new RegExp(dataset.name) })).toBeVisible()
    const others = page.getByRole('row').filter({ hasNotText: worker.user.name }).filter({ hasText: /Created|Updated|Uploaded|Invited|Joined/ })
    await expect(others).toHaveCount(0)
  })

  test('only admins can open the page', async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile('lab') })
    const page = await context.newPage()
    await page.goto('/admin/activity-logs')
    await expect(page).toHaveURL(/\/home$/)
    await context.close()
  })
})

test.describe('permission management', () => {
  test.use({ storageState: authFile('admin') })

  test('lists, changes and deletes a permission', async ({ page, request }) => {
    const admin = await login(request, 'admin')
    const lab = await login(request, 'lab')
    const external = await activeUser(request, admin, UserRoles.EXTERNAL, `Reader ${uid()}`)
    const dataset = await createDataset(request, lab)
    await grant(request, lab, dataset.id, external.user.id, PermissionOptions.VIEW)

    await page.goto(`/admin/permissions?user=${external.user.id}`)
    const row = page.getByRole('row', { name: new RegExp(dataset.name) })
    await expect(row).toContainText(external.user.name)
    await expect(row).toContainText(PermissionOptions.VIEW)

    // Change VIEW to DOWNLOAD in the row's dropdown
    await row.locator('.v-field').click()
    await page.getByRole('option', { name: PermissionOptions.DOWNLOAD }).click()
    await expect.poll(async () => (await getPermission(request, lab, external.user.id, dataset.id)).perm).toBe(PermissionOptions.DOWNLOAD)

    // Delete it after confirming
    await row.getByRole('button', { name: 'Delete permission' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText(external.user.name)
    await dialog.getByRole('button', { name: 'Delete' }).click()
    await expect(row).toHaveCount(0)
    expect((await getPermission(request, lab, external.user.id, dataset.id)).status).toBe(404)
  })

  test('creates a permission from the dialog', async ({ page, request }) => {
    const admin = await login(request, 'admin')
    const lab = await login(request, 'lab')
    const external = await activeUser(request, admin, UserRoles.EXTERNAL, `Newcomer ${uid()}`)
    const dataset = await createDataset(request, lab)

    await page.goto('/admin/permissions')
    await page.getByRole('button', { name: 'New Permission' }).click()
    const dialog = page.getByRole('dialog')
    await pickOption(page, dialog.locator('.v-field', { hasText: 'Dataset' }), dataset.name)
    await pickOption(page, dialog.locator('.v-field', { hasText: 'User' }), external.user.name)
    await pickOption(page, dialog.locator('.v-field', { hasText: 'Permission' }), PermissionOptions.DOWNLOAD)
    await dialog.getByRole('button', { name: 'Create' }).click()
    await expect(dialog).toBeHidden()
    expect((await getPermission(request, lab, external.user.id, dataset.id)).perm).toBe(PermissionOptions.DOWNLOAD)
  })

  test('a dataset owner sees only the permissions of their own datasets', async ({ browser, request }) => {
    const admin = await login(request, 'admin')
    const owner = await activeUser(request, admin, UserRoles.LAB_MEMBER, `Owner ${uid()}`)
    const external = await activeUser(request, admin, UserRoles.EXTERNAL, `Guest ${uid()}`)
    const mine = await createDataset(request, owner)
    const lab = await login(request, 'lab')
    const theirs = await createDataset(request, lab)
    await grant(request, owner, mine.id, external.user.id, PermissionOptions.VIEW)
    await grant(request, lab, theirs.id, external.user.id, PermissionOptions.VIEW)

    const context = await browser.newContext({ storageState: LOGGED_OUT })
    const page = await context.newPage()
    await page.goto('/login')
    await submitLogin(page, owner.email, owner.password)
    await expect(page).toHaveURL(/\/home$/)
    await page.goto('/admin/permissions')
    await expect(page.getByRole('row', { name: new RegExp(mine.name) })).toBeVisible()
    await expect(page.getByRole('row', { name: new RegExp(theirs.name) })).toHaveCount(0)
    await context.close()
  })
})

test.describe('settings', () => {
  test('a user can change their own name', async ({ browser, request }) => {
    const admin = await login(request, 'admin')
    const user = await activeUser(request, admin, UserRoles.EXTERNAL, `Before ${uid()}`)
    const context = await browser.newContext({ storageState: LOGGED_OUT })
    const page = await context.newPage()
    await page.goto('/login')
    await submitLogin(page, user.email, user.password)
    await expect(page).toHaveURL(/\/home$/)

    await page.goto('/settings')
    const renamed = `After ${uid()}`
    await page.getByRole('textbox', { name: 'Name' }).fill(renamed)
    await page.getByRole('button', { name: 'Save Name' }).click()
    await expect(page.getByText('Name updated.')).toBeVisible()
    await page.reload()
    await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue(renamed)
    // Plain users get no admin section
    await expect(page.getByText('ADMIN', { exact: true })).toHaveCount(0)
    await context.close()
  })

  test.describe('as an admin', () => {
    test.use({ storageState: authFile('admin') })

    test('the visibility switch publishes and hides a dataset', async ({ page, request }) => {
      const lab = await login(request, 'lab')
      const dataset = await createDataset(request, lab)
      await page.goto('/settings')
      const row = page.locator('.v-row', { hasText: dataset.name })
      await expect(row).toBeVisible()
      await row.getByRole('checkbox').setChecked(true)
      await expect.poll(async () => (await getDataset(request, lab, dataset.id)).visibility).toBe(DatasetVisibility.PUBLIC)
      await row.getByRole('checkbox').setChecked(false)
      await expect.poll(async () => (await getDataset(request, lab, dataset.id)).visibility).toBe(DatasetVisibility.PRIVATE)
    })

    test('shows the management links', async ({ page }) => {
      await page.goto('/settings')
      await page.getByRole('button', { name: 'User Management' }).click()
      await expect(page).toHaveURL(/\/admin\/user-mgmt$/)
    })
  })
})

