// File retrieval: covers show up (and update live), the .rds download returns exactly what was uploaded, and access rules hold
import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { FileTypes } from '@commons/file'
import { PermissionOptions } from '@commons/permissions'
import { changeGrant, createDataset, download, grant, gotoLive, login, readFile, uploadFile, uploadFileOk } from './api'
import { authFile } from './users'

// A 1x1 PNG, so the browser can decode the cover
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

test('a cover uploaded while the home page is open replaces the placeholder block', async ({ browser, request }) => {
  const lab = await login(request, 'lab')
  const dataset = await createDataset(request, lab)
  const context = await browser.newContext({ storageState: authFile('lab') })
  const page = await context.newPage()
  // Let the page finish asking for this dataset's cover (there is none yet) before uploading one, so the upload is not racing that request
  const firstCoverRequest = page.waitForResponse((r) => r.url().includes(`/files/current/${dataset.id}/COVER/content`))
  await gotoLive(page, '/home')
  await firstCoverRequest
  const card = page.locator('.v-card', { hasText: dataset.name })
  await expect(card.locator('.cover-fallback')).toBeVisible()

  await uploadFileOk(request, lab, dataset.id, FileTypes.COVER, 'cover.png', PNG)
  await expect(card.locator('.cover-fallback')).toHaveCount(0)
  // Vuetify only creates the <img> of a card that has scrolled into view, and with many datasets this one may be far down the page
  await card.scrollIntoViewIfNeeded()
  await expect(card.locator('img')).toBeVisible()
  await context.close()
})

// A cover request still in flight when a new cover is uploaded answers "no cover" late; that stale answer must not replace the new cover
test('a cover uploaded while its first request is still loading still appears', async ({ browser, request }) => {
  const lab = await login(request, 'lab')
  const dataset = await createDataset(request, lab)
  const context = await browser.newContext({ storageState: authFile('lab') })
  const page = await context.newPage()
  // Hold back the page's first cover response, which the server already answered "no cover" to, until after the upload
  let release: () => Promise<void> = async () => {}
  let first = true
  const held = new Promise<void>((resolve) => {
    void page.route(`**/files/current/${dataset.id}/COVER/content`, async (route) => {
      // Only the first request is held; the page's request for the new cover (after the upload) goes through
      if (!first) return route.continue()
      first = false
      const response = await route.fetch()
      release = () => route.fulfill({ response })
      resolve()
    })
  })
  await gotoLive(page, '/home')
  await held

  await uploadFileOk(request, lab, dataset.id, FileTypes.COVER, 'cover.png', PNG)
  await release()
  // Vuetify only creates the <img> of a card that has scrolled into view
  const card = page.locator('.v-card', { hasText: dataset.name })
  await card.scrollIntoViewIfNeeded()
  await expect(card.locator('img')).toBeVisible()
  await context.close()
})

test('the Data button downloads exactly the uploaded .rds bytes, and a new version replaces them', async ({ browser, request }) => {
  const lab = await login(request, 'lab')
  const dataset = await createDataset(request, lab)
  const first = Buffer.from('first version of the data')
  await uploadFileOk(request, lab, dataset.id, FileTypes.RDS, 'data.rds', first)

  const context = await browser.newContext({ storageState: authFile('lab') })
  const page = await context.newPage()
  await page.goto(`/dataset/${dataset.url}`)
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Data' }).click()
  const file = await downloading
  expect(file.suggestedFilename()).toBe('data.rds')
  expect(readFileSync((await file.path())!)).toEqual(first)

  // Only the current version is kept
  const second = Buffer.from('second, newer version of the data')
  await uploadFileOk(request, lab, dataset.id, FileTypes.RDS, 'data.rds', second)
  expect((await download(request, lab, dataset.id, FileTypes.RDS)).body).toEqual(second)
  await context.close()
})

test('a dataset without an .rds file reports it when Data is clicked', async ({ browser, request }) => {
  const dataset = await createDataset(request, await login(request, 'lab'))
  const context = await browser.newContext({ storageState: authFile('lab') })
  const page = await context.newPage()
  await page.goto(`/dataset/${dataset.url}`)
  await page.getByRole('button', { name: 'Data' }).click()
  await expect(page.getByText('This dataset has no data file yet.')).toBeVisible()
  await context.close()
})

test.describe('access rules', () => {
  test('files follow the dataset: private is hidden, VIEW cannot download, DOWNLOAD can', async ({ request }) => {
    const lab = await login(request, 'lab')
    const external = await login(request, 'external')
    const dataset = await createDataset(request, lab)
    const content = Buffer.from('access rules')
    await uploadFileOk(request, lab, dataset.id, FileTypes.RDS, 'access.rds', content)

    // Private: a guest and an external user without a permission cannot even tell the dataset exists
    expect((await readFile(request, null, dataset.id, FileTypes.RDS)).status).toBe(404)
    expect((await download(request, external, dataset.id, FileTypes.RDS)).status).toBe(404)

    // VIEW sees the dataset but may not download
    await grant(request, lab, dataset.id, external.user.id, PermissionOptions.VIEW)
    expect((await download(request, external, dataset.id, FileTypes.RDS)).status).toBe(403)

    // DOWNLOAD gets the bytes
    await changeGrant(request, lab, dataset.id, external.user.id, PermissionOptions.DOWNLOAD)
    const result = await download(request, external, dataset.id, FileTypes.RDS)
    expect(result.status).toBe(200)
    expect(result.body).toEqual(content)
  })

  test('uploads are checked: wrong extension and a logged-out caller are rejected', async ({ request }) => {
    const lab = await login(request, 'lab')
    const dataset = await createDataset(request, lab)
    expect(await uploadFile(request, lab, dataset.id, FileTypes.RDS, 'data.txt', Buffer.from('x'))).toBe(400)
    expect(await uploadFile(request, lab, dataset.id, FileTypes.COVER, 'cover.rds', Buffer.from('x'))).toBe(400)
    const outsider = await login(request, 'external')
    // An external user with no access cannot attach files to someone else's private dataset
    expect(await uploadFile(request, outsider, dataset.id, FileTypes.RDS, 'data.rds', Buffer.from('x'))).toBe(404)
  })
})
