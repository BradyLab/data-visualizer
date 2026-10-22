// The dataset form in edit mode and its url rules, including what happens when someone else changes the dataset meanwhile
import { test, expect, type Page } from '@playwright/test'
import { FileTypes } from '@commons/file'
import { DatasetPlots, DatasetVisibility, slugify } from '@commons/dataset'
import { PermissionOptions } from '@commons/permissions'
import { UserRoles } from '@commons/user'
import {
  activeUser,
  createDataset,
  deleteDataset,
  getDataset,
  getDatasetByUrl,
  getPermission,
  fileRecordResponse,
  grant,
  listFiles,
  uploadFileOk,
  gotoLive,
  login,
  revoke,
  tryDeleteDataset,
  uid,
  updateDataset,
} from './api'
import { pickPlot, pickUmapOnly } from './dataset-form'
import { countRowsOfDataset } from './db'
import { loginLive } from './login'
import { authFile, LOGGED_OUT } from './users'

test.use({ storageState: authFile('lab') })

// A 1x1 PNG, so the cover is a valid image
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

const NAME = 'DATASET NAME'
const DESCRIPTION = 'Type a description of the dataset here'

test('edits a dataset: fields and plots are saved', async ({ page, request }) => {
  const lab = await login(request, 'lab')
  const dataset = await createDataset(request, lab)
  await page.goto(`/dataset/${dataset.url}/edit`)
  // The form is filled from the saved dataset
  await expect(page.getByPlaceholder(NAME)).toHaveValue(dataset.name)

  const name = `Edited ${uid()}`
  await page.getByPlaceholder(NAME).fill(name)
  await page.getByPlaceholder(DESCRIPTION).fill('A new description')
  await page.getByPlaceholder('Add DOI link here').fill('10.1234/e2e')
  await page.getByPlaceholder('Add attribution here').fill('The e2e lab')
  await pickPlot(page, DatasetPlots.UMAP)
  await page.getByRole('button', { name: 'Save Changes' }).click()

  // Saving opens the dataset page, which shows the new values
  await expect(page).toHaveURL(new RegExp(`/dataset/${dataset.url}$`))
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await expect(page.getByText('A new description')).toBeVisible()
  const saved = await getDataset(request, lab, dataset.id)
  expect(saved).toMatchObject({ name, description: 'A new description', doi: '10.1234/e2e', attribution: 'The e2e lab' })
  expect(saved.plots).toEqual([DatasetPlots.UMAP])
})

test('changing the url moves the dataset to the new address', async ({ page, request }) => {
  const lab = await login(request, 'lab')
  const dataset = await createDataset(request, lab)
  const newUrl = `moved-${uid()}`
  await page.goto(`/dataset/${dataset.url}/edit`)
  await expect(page.getByPlaceholder(NAME)).toHaveValue(dataset.name)
  await page.getByPlaceholder('dataset-url').fill(newUrl)
  await page.getByRole('button', { name: 'Save Changes' }).click()
  await expect(page).toHaveURL(new RegExp(`/dataset/${newUrl}$`))
  await expect(page.getByRole('heading', { name: dataset.name })).toBeVisible()

  // The old address no longer finds it
  expect((await getDatasetByUrl(request, lab, dataset.url)).status()).toBe(404)
  await page.goto(`/dataset/${dataset.url}`)
  await expect(page.getByText('Dataset not found')).toBeVisible()
})

test.describe('url rules when creating', () => {
  test('the reserved url "new" is refused', async ({ page }) => {
    await page.goto('/dataset/new')
    await page.getByPlaceholder(NAME).fill('New')
    await expect(page.getByText('"new" is reserved and cannot be used as a url')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create New Dataset' })).toBeDisabled()
  })

  test('the url follows the name until it is typed, and is cleaned up when saved', async ({ page, request }) => {
    const lab = await login(request, 'lab')
    const suffix = uid()
    await page.goto('/dataset/new')
    await page.getByPlaceholder(NAME).fill(`Mixed Case ${suffix}!`)
    await expect(page.getByPlaceholder('dataset-url')).toHaveValue(slugify(`Mixed Case ${suffix}!`))
    // Typing a url of their own stops it following the name; it is normalised on save
    await page.getByPlaceholder('dataset-url').fill(`My Own URL ${suffix}`)
    await page.getByPlaceholder(NAME).fill(`Renamed ${suffix}`)
    await expect(page.getByPlaceholder('dataset-url')).toHaveValue(`My Own URL ${suffix}`)
    await pickUmapOnly(page)
    await page.getByRole('button', { name: 'Create New Dataset' }).click()
    const url = slugify(`My Own URL ${suffix}`)
    await expect(page).toHaveURL(new RegExp(`/dataset/${url}$`))
    expect((await getDatasetByUrl(request, lab, url)).status()).toBe(200)
  })

  test('a url already in use is refused with a message', async ({ page, request }) => {
    const existing = await createDataset(request, await login(request, 'lab'))
    await page.goto('/dataset/new')
    await page.getByPlaceholder(NAME).fill(`Second ${uid()}`)
    await page.getByPlaceholder('dataset-url').fill(existing.url)
    await pickUmapOnly(page)
    await page.getByRole('button', { name: 'Create New Dataset' }).click()
    await expect(page.getByText('The url is already in use by another dataset.')).toBeVisible()
    await expect(page).toHaveURL(/\/dataset\/new$/)
  })
})

test.describe('while the form is open', () => {
  test('a change by someone else raises a warning, and "Load their version" takes it', async ({ page, request }) => {
    const lab = await login(request, 'lab')
    const admin = await login(request, 'admin')
    const dataset = await createDataset(request, lab)
    await gotoLive(page, `/dataset/${dataset.url}/edit`)
    await expect(page.getByPlaceholder(NAME)).toHaveValue(dataset.name)
    await page.getByPlaceholder(DESCRIPTION).fill('My unsaved words')

    await updateDataset(request, admin, dataset.id, { description: 'Their words' })
    await expect(page.getByText('Someone else changed this dataset while you were editing.')).toBeVisible()
    await page.getByRole('button', { name: 'Load their version' }).click()
    await expect(page.getByPlaceholder(DESCRIPTION)).toHaveValue('Their words')
    await expect(page.getByText('Someone else changed this dataset')).toHaveCount(0)
  })

  test('"Keep mine" dismisses the warning and saving overwrites their change', async ({ page, request }) => {
    const lab = await login(request, 'lab')
    const admin = await login(request, 'admin')
    const dataset = await createDataset(request, lab)
    await gotoLive(page, `/dataset/${dataset.url}/edit`)
    await expect(page.getByPlaceholder(NAME)).toHaveValue(dataset.name)
    await page.getByPlaceholder(DESCRIPTION).fill('Mine wins')

    await updateDataset(request, admin, dataset.id, { description: 'Theirs loses' })
    await page.getByRole('button', { name: 'Keep mine' }).click()
    await expect(page.getByText('Someone else changed this dataset')).toHaveCount(0)
    await page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(page).toHaveURL(new RegExp(`/dataset/${dataset.url}$`))
    expect((await getDataset(request, lab, dataset.id)).description).toBe('Mine wins')
  })

  test('a url changed by someone else keeps the address bar on the dataset', async ({ page, request }) => {
    const lab = await login(request, 'lab')
    const dataset = await createDataset(request, lab)
    await gotoLive(page, `/dataset/${dataset.url}/edit`)
    await expect(page.getByPlaceholder(NAME)).toHaveValue(dataset.name)
    const moved = `moved-${uid()}`
    await updateDataset(request, await login(request, 'admin'), dataset.id, { url: moved })
    await expect(page).toHaveURL(new RegExp(`/dataset/${moved}/edit$`))
  })

  test('a deleted dataset blocks saving', async ({ page, request }) => {
    const lab = await login(request, 'lab')
    const dataset = await createDataset(request, lab)
    await gotoLive(page, `/dataset/${dataset.url}/edit`)
    await expect(page.getByPlaceholder(NAME)).toHaveValue(dataset.name)

    await deleteDataset(request, lab, dataset.id)
    await expect(page.getByText("This dataset was deleted or is no longer available to you, so it can't be saved.")).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  })
})

test.describe('deleting a dataset', () => {
  const deleteButton = (page: Page) => page.getByRole('button', { name: 'Delete Dataset' })

  test('there is no delete button on the new dataset form', async ({ page }) => {
    await page.goto('/dataset/new')
    await expect(page.getByPlaceholder(NAME)).toBeVisible()
    await expect(deleteButton(page)).toHaveCount(0)
  })

  test('the delete button sits on the left of the save button, in the same row', async ({ page, request }) => {
    const dataset = await createDataset(request, await login(request, 'lab'))
    await page.goto(`/dataset/${dataset.url}/edit`)
    await expect(page.getByPlaceholder(NAME)).toHaveValue(dataset.name)
    const del = await deleteButton(page).boundingBox()
    const save = await page.getByRole('button', { name: 'Save Changes' }).boundingBox()
    expect(del!.x).toBeLessThan(save!.x)
    expect(Math.abs(del!.y - save!.y)).toBeLessThan(8)
  })

  test('cancelling the confirmation keeps the dataset', async ({ page, request }) => {
    const lab = await login(request, 'lab')
    const dataset = await createDataset(request, lab)
    await page.goto(`/dataset/${dataset.url}/edit`)
    await expect(page.getByPlaceholder(NAME)).toHaveValue(dataset.name)
    await deleteButton(page).click()
    await expect(page.getByText(`Delete ${dataset.name}? This cannot be undone.`)).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('This cannot be undone.')).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`/dataset/${dataset.url}/edit$`))
    expect((await getDatasetByUrl(request, lab, dataset.url)).status()).toBe(200)
  })

  test('confirming deletes the dataset and goes home; its permissions and files are deleted with it', async ({ page, request }) => {
    const admin = await login(request, 'admin')
    const lab = await login(request, 'lab')
    const viewer = await activeUser(request, admin, UserRoles.LAB_MEMBER)
    const dataset = await createDataset(request, lab)
    await grant(request, lab, dataset.id, viewer.user.id, PermissionOptions.EDIT)
    await uploadFileOk(request, lab, dataset.id, FileTypes.COVER, 'cover.png', PNG)
    await uploadFileOk(request, lab, dataset.id, FileTypes.TISSUE_PLOT, 'map.csv', Buffer.from('ROI.name,ROI.id,x,y\na,1,0,0\n'))
    const [cover] = await listFiles(request, lab, dataset.id)
    expect(countRowsOfDataset('Permissions', dataset.id)).toBe(1)
    expect(countRowsOfDataset('Files', dataset.id)).toBeGreaterThan(0)

    await page.goto(`/dataset/${dataset.url}/edit`)
    await expect(page.getByPlaceholder(NAME)).toHaveValue(dataset.name)
    await deleteButton(page).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()

    await expect(page).toHaveURL(/\/home$/)
    expect((await getDatasetByUrl(request, lab, dataset.url)).status()).toBe(404)
    // The rows that belonged to the dataset are gone, not just hidden
    expect(countRowsOfDataset('Permissions', dataset.id)).toBe(0)
    expect(countRowsOfDataset('Files', dataset.id)).toBe(0)
    expect((await fileRecordResponse(request, admin, cover!.id)).status()).toBe(404)
    // The viewer's account is untouched by the cascade
    expect((await getPermission(request, admin, viewer.user.id, dataset.id)).perm).toBeNull()
  })

  test('a failed delete keeps the form open with an error', async ({ page, request }) => {
    const dataset = await createDataset(request, await login(request, 'lab'))
    await page.route(`**/datasets/${dataset.id}`, (route) =>
      route.request().method() === 'DELETE' ? route.fulfill({ status: 500, body: '{}' }) : route.continue()
    )
    await page.goto(`/dataset/${dataset.url}/edit`)
    await expect(page.getByPlaceholder(NAME)).toHaveValue(dataset.name)
    await deleteButton(page).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText('Unable to delete the dataset. Please try again.')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/dataset/${dataset.url}/edit$`))
  })

  test('an editor who is not an owner cannot delete: the server refuses', async ({ request }) => {
    const admin = await login(request, 'admin')
    const owner = await login(request, 'lab')
    const editor = await activeUser(request, admin, UserRoles.LAB_MEMBER)
    const dataset = await createDataset(request, owner)
    await grant(request, owner, dataset.id, editor.user.id, PermissionOptions.EDIT)
    expect((await tryDeleteDataset(request, editor, dataset.id)).status()).toBe(403)
    expect(countRowsOfDataset('Permissions', dataset.id)).toBe(1)
  })
})

test.describe('who may edit', () => {
  test('a viewer without edit access is sent to the dataset page', async ({ browser, request }) => {
    const dataset = await createDataset(request, await login(request, 'lab'), { visibility: DatasetVisibility.PUBLIC })
    const context = await browser.newContext({ storageState: authFile('external') })
    const page = await context.newPage()
    await page.goto(`/dataset/${dataset.url}/edit`)
    await expect(page).toHaveURL(new RegExp(`/dataset/${dataset.url}$`))
    await expect(page.getByRole('heading', { name: dataset.name })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0)
    await context.close()
  })

  test('losing edit access while the form is open sends the editor to the dataset page', async ({ browser, request }) => {
    const admin = await login(request, 'admin')
    const owner = await login(request, 'lab')
    const editor = await activeUser(request, admin, UserRoles.LAB_MEMBER)
    const dataset = await createDataset(request, owner)
    await grant(request, owner, dataset.id, editor.user.id, PermissionOptions.EDIT)

    const context = await browser.newContext({ storageState: LOGGED_OUT })
    const page = await context.newPage()
    await loginLive(page, editor.email, editor.password)
    await page.goto(`/dataset/${dataset.url}/edit`)
    await expect(page.getByPlaceholder(NAME)).toHaveValue(dataset.name)

    await revoke(request, owner, dataset.id, editor.user.id)
    await expect(page).toHaveURL(new RegExp(`/dataset/${dataset.url}$`))
    await context.close()
  })
})
