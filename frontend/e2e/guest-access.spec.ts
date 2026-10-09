// What a logged-out visitor, and an invited user who has not set a password yet, can and cannot see or do
import { test, expect } from '@playwright/test'
import { DatasetVisibility } from '@commons/dataset'
import { FileTypes } from '@commons/file'
import { UserRoles } from '@commons/user'
import {
  createDataset,
  download,
  inviteUser,
  listDatasets,
  login,
  readFile,
  tryCreateDataset,
  uploadFileOk,
} from './api'
import { LOGGED_OUT } from './users'

test.use({ storageState: LOGGED_OUT })

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

test('a guest sees public datasets only, and can open a public one without edit or download buttons', async ({ page, request }) => {
  const lab = await login(request, 'lab')
  const open = await createDataset(request, lab, { visibility: DatasetVisibility.PUBLIC })
  const hidden = await createDataset(request, lab)

  await page.goto('/home')
  await expect(page.getByText(open.name)).toBeVisible()
  await expect(page.getByText(hidden.name)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'New Dataset' })).toHaveCount(0)

  await page.getByText(open.name).click()
  await expect(page).toHaveURL(new RegExp(`/dataset/${open.url}$`))
  await expect(page.getByRole('heading', { name: open.name })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Data' })).toHaveCount(0)
})

test('a private dataset looks like it does not exist to a guest', async ({ page, request }) => {
  const dataset = await createDataset(request, await login(request, 'lab'))
  await page.goto(`/dataset/${dataset.url}`)
  await expect(page.getByText('Dataset not found')).toBeVisible()
  await expect(page.getByText(dataset.name)).toHaveCount(0)
})

test('a guest sees a public dataset\'s cover but cannot download its data', async ({ page, request }) => {
  const lab = await login(request, 'lab')
  const dataset = await createDataset(request, lab, { visibility: DatasetVisibility.PUBLIC })
  await uploadFileOk(request, lab, dataset.id, FileTypes.COVER, 'cover.png', PNG)
  await uploadFileOk(request, lab, dataset.id, FileTypes.RDS, 'data.rds', Buffer.from('data'))

  await page.goto('/home')
  const card = page.locator('.v-card', { hasText: dataset.name })
  // Vuetify only creates the <img> of a card that has scrolled into view
  await card.scrollIntoViewIfNeeded()
  await expect(card.locator('img')).toBeVisible()
  expect((await readFile(request, null, dataset.id, FileTypes.COVER)).body).toEqual(PNG)
  // The data needs a login and download access, which a guest cannot have
  expect((await download(request, null, dataset.id, FileTypes.RDS)).status).toBe(401)
  expect((await readFile(request, null, dataset.id, FileTypes.RDS)).status).toBe(403)
})

test('protected pages send a guest to log in', async ({ page }) => {
  for (const path of ['/dataset/new', '/admin/permissions']) {
    await page.goto(path)
    await expect(page).toHaveURL(new RegExp(`/login\\?redirect=${path}`))
  }
})

test('an invited user who has not changed the default password is treated as a guest', async ({ request }) => {
  const admin = await login(request, 'admin')
  const lab = await login(request, 'lab')
  const open = await createDataset(request, lab, { visibility: DatasetVisibility.PUBLIC })
  const hidden = await createDataset(request, lab)
  // Even an invited lab member, who will see everything once active
  const invited = await inviteUser(request, admin, UserRoles.LAB_MEMBER)

  const names = ((await (await listDatasets(request, invited)).json()) as { name: string }[]).map((d) => d.name)
  expect(names).toContain(open.name)
  expect(names).not.toContain(hidden.name)
  // Anything that needs a real login asks for the password change first
  const refused = await tryCreateDataset(request, invited)
  expect(refused.status()).toBe(403)
  expect((await refused.json()).code).toBe('PASSWORD_CHANGE_REQUIRED')
})
