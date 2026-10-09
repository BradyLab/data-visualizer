// What happens to a user, live, when their role or permissions change, and what edit access to someone else's dataset allows
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
  login,
  tryUpdateDataset,
  updateUser,
  uid,
} from './api'
import { loginLive } from './login'
import { LOGGED_OUT } from './users'

test.use({ storageState: LOGGED_OUT })

test('demoting a lab member to external removes the private datasets and the New Dataset button live', async ({ browser, request }) => {
  const admin = await login(request, 'admin')
  const owner = await login(request, 'lab')
  const member = await activeUser(request, admin, UserRoles.LAB_MEMBER)
  const dataset = await createDataset(request, owner)

  const context = await browser.newContext()
  const page = await context.newPage()
  await loginLive(page, member.email, member.password)
  // Lab members see every dataset, private ones included, and may create their own
  await expect(page.getByText(dataset.name)).toBeVisible()
  await expect(page.getByRole('button', { name: 'New Dataset' })).toBeVisible()

  expect((await updateUser(request, admin, member.user.id, { role: UserRoles.EXTERNAL })).status()).toBe(200)
  await expect(page.getByText(dataset.name)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'New Dataset' })).toHaveCount(0)
  await context.close()
})

test('demoting a lab member who is on a dataset-creation page sends them home', async ({ browser, request }) => {
  const admin = await login(request, 'admin')
  const member = await activeUser(request, admin, UserRoles.LAB_MEMBER)
  const context = await browser.newContext()
  const page = await context.newPage()
  await loginLive(page, member.email, member.password)
  await page.goto('/dataset/new')
  await expect(page.getByPlaceholder('DATASET NAME')).toBeVisible()

  await updateUser(request, admin, member.user.id, { role: UserRoles.EXTERNAL })
  await expect(page).toHaveURL(/\/home$/)
  await context.close()
})

test('demoting a lab member with EDIT access downgrades it, and the Edit button goes away live', async ({ browser, request }) => {
  const admin = await login(request, 'admin')
  const owner = await login(request, 'lab')
  const member = await activeUser(request, admin, UserRoles.LAB_MEMBER)
  // Public, so the member can still view it as an external user
  const dataset = await createDataset(request, owner, { visibility: DatasetVisibility.PUBLIC })
  await grant(request, owner, dataset.id, member.user.id, PermissionOptions.EDIT)

  const context = await browser.newContext()
  const page = await context.newPage()
  await loginLive(page, member.email, member.password)
  await page.goto(`/dataset/${dataset.url}`)
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible()

  await updateUser(request, admin, member.user.id, { role: UserRoles.EXTERNAL })
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0)
  expect((await getPermission(request, owner, member.user.id, dataset.id)).perm).toBe(PermissionOptions.DOWNLOAD)
  await context.close()
})

test.describe("a lab member working on someone else's dataset", () => {
  test('with EDIT access can change it, but not its visibility', async ({ browser, request }) => {
    const admin = await login(request, 'admin')
    const owner = await login(request, 'lab')
    const editor = await activeUser(request, admin, UserRoles.LAB_MEMBER)
    const dataset = await createDataset(request, owner)
    await grant(request, owner, dataset.id, editor.user.id, PermissionOptions.EDIT)

    const context = await browser.newContext()
    const page = await context.newPage()
    await loginLive(page, editor.email, editor.password)
    await page.goto(`/dataset/${dataset.url}`)
    await page.getByRole('button', { name: 'Edit' }).click()
    await expect(page).toHaveURL(new RegExp(`/dataset/${dataset.url}/edit$`))
    // The form fills itself from the saved dataset a moment after it opens, which would overwrite what is typed before that
    await expect(page.getByPlaceholder('DATASET NAME')).toHaveValue(dataset.name)
    const description = `Edited by ${editor.user.name}`
    await page.getByPlaceholder('Type a description of the dataset here').fill(description)
    await page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(page).toHaveURL(new RegExp(`/dataset/${dataset.url}$`))
    expect((await getDataset(request, owner, dataset.id)).description).toBe(description)

    // Publishing is the owner's decision
    expect((await tryUpdateDataset(request, editor, dataset.id, { visibility: DatasetVisibility.PUBLIC })).status()).toBe(403)
    await context.close()
  })

  test('without EDIT access can see and download it but not edit it', async ({ browser, request }) => {
    const admin = await login(request, 'admin')
    const owner = await login(request, 'lab')
    const viewer = await activeUser(request, admin, UserRoles.LAB_MEMBER)
    const dataset = await createDataset(request, owner)

    const context = await browser.newContext()
    const page = await context.newPage()
    await loginLive(page, viewer.email, viewer.password)
    await page.goto(`/dataset/${dataset.url}`)
    await expect(page.getByRole('heading', { name: dataset.name })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Data' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0)

    // The edit page sends them back, and the API refuses the change itself
    await page.goto(`/dataset/${dataset.url}/edit`)
    await expect(page).toHaveURL(new RegExp(`/dataset/${dataset.url}$`))
    expect((await tryUpdateDataset(request, viewer, dataset.id, { description: `Sneaky ${uid()}` })).status()).toBe(403)
    await context.close()
  })
})
