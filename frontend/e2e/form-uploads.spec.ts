// File uploads made through the dataset form: cover and .rds on create, new .rds versions with notes, and a failed upload after the save
import { test, expect } from '@playwright/test'
import { FileTypes } from '@commons/file'
import { createDataset, download, getDatasetByUrl, listFiles, login, readFile, uid, uploadFileOk } from './api'
import { authFile } from './users'

test.use({ storageState: authFile('lab') })

// A 1x1 PNG, so the browser can decode the cover
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)
const NAME = 'DATASET NAME'

test('a new dataset takes a cover and an .rds file together', async ({ page, request }) => {
  const lab = await login(request, 'lab')
  const slug = `both-${uid()}`
  const rds = Buffer.from('rds sent with the cover')
  await page.goto('/dataset/new')
  await page.getByPlaceholder(NAME).fill(`Both files ${slug}`)
  await page.getByPlaceholder('dataset-url').fill(slug)
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: PNG })
  await page.locator('input[type="file"][accept=".rds"]').setInputFiles({ name: 'both.rds', mimeType: 'application/octet-stream', buffer: rds })
  await page.getByRole('button', { name: 'Create New Dataset' }).click()
  await expect(page).toHaveURL(new RegExp(`/dataset/${slug}$`))

  const dataset = await (await getDatasetByUrl(request, lab, slug)).json()
  expect((await readFile(request, lab, dataset.id, FileTypes.COVER)).body).toEqual(PNG)
  expect((await download(request, lab, dataset.id, FileTypes.RDS)).body).toEqual(rds)
})

test('a new .rds version through the form keeps the history and the update notes', async ({ page, request }) => {
  const lab = await login(request, 'lab')
  const dataset = await createDataset(request, lab)
  await uploadFileOk(request, lab, dataset.id, FileTypes.RDS, 'data.rds', Buffer.from('version one'))

  await page.goto(`/dataset/${dataset.url}/edit`)
  await expect(page.getByPlaceholder(NAME)).toHaveValue(dataset.name)
  const second = Buffer.from('version two, with changes')
  await page.locator('input[type="file"][accept=".rds"]').setInputFiles({ name: 'data.rds', mimeType: 'application/octet-stream', buffer: second })
  // The notes box only exists once a file is picked
  await page.getByPlaceholder('Describe what changed since the last version of the .rds file').fill('Added the second batch')
  await page.getByRole('button', { name: 'Save Changes' }).click()
  await expect(page).toHaveURL(new RegExp(`/dataset/${dataset.url}$`))

  const files = (await listFiles(request, lab, dataset.id)).filter((f) => f.type === FileTypes.RDS)
  expect(files.map((f) => [f.version, f.isCurrent, f.updates])).toEqual([
    [1, false, null],
    [2, true, 'Added the second batch'],
  ])
  // Only the newest bytes are kept
  expect((await download(request, lab, dataset.id, FileTypes.RDS)).body).toEqual(second)
})

test('a failed upload keeps the saved dataset and stays on its edit page with the reason', async ({ page, request }) => {
  const lab = await login(request, 'lab')
  const slug = `failed-${uid()}`
  await page.goto('/dataset/new')
  await page.getByPlaceholder(NAME).fill(`Failed upload ${slug}`)
  await page.getByPlaceholder('dataset-url').fill(slug)
  // The picker's accept filter is only a hint: the server is what refuses a wrong extension
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: 'cover.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') })
  await page.getByRole('button', { name: 'Create New Dataset' }).click()

  await expect(page.getByText('The dataset was saved, but a file could not be uploaded.')).toBeVisible()
  await expect(page.getByText(/must have one of these extensions/)).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/dataset/${slug}/edit$`))
  // The dataset exists and has no cover
  const response = await getDatasetByUrl(request, lab, slug)
  expect(response.status()).toBe(200)
  expect((await readFile(request, lab, (await response.json()).id, FileTypes.COVER)).status).toBe(404)
})
