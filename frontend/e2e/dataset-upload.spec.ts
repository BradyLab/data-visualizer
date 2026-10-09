// Core journey: a lab member creates a dataset with an .rds file through the form, then opens its page
import { test, expect } from '@playwright/test'
import { authFile } from './users'

test.use({ storageState: authFile('lab') })

test('creates a dataset with an .rds upload and shows it', async ({ page }) => {
  // Unique per run, so reruns against a database that was not reset do not collide
  const slug = `smoke-${Date.now()}`
  const name = `Smoke dataset ${slug}`

  await page.goto('/dataset/new')
  await page.getByPlaceholder('DATASET NAME').fill(name)
  await page.getByPlaceholder('Type a description of the dataset here').fill('Created by the e2e smoke test')
  await page.getByPlaceholder('dataset-url').fill(slug)
  // The file input inside Vuetify's dropzone is hidden, but Playwright can still set files on it
  await page.locator('input[type="file"][accept=".rds"]').setInputFiles({
    name: 'smoke.rds',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('not a real rds file; the backend only checks the extension'),
  })
  await page.getByRole('button', { name: 'Create New Dataset' }).click()

  // After saving and uploading, the app leaves the form for the dataset page
  await expect(page).toHaveURL(new RegExp(`/dataset/${slug}$`))
  await expect(page.getByRole('heading', { name })).toBeVisible()
  // The Data button only shows for users who may download, and the download itself needs the uploaded file to exist
  await expect(page.getByRole('button', { name: 'Data' })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Data' }).click()
  expect((await download).suggestedFilename()).toContain('smoke')
})
