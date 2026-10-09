// Live updates: changes made by one user show up in other users' open pages without a reload (Socket.IO pushes, see commons/socket.ts)
import { test, expect } from '@playwright/test'
import { DatasetVisibility } from '@commons/dataset'
import { PermissionOptions } from '@commons/permissions'
import { createDataset, deleteDataset, grant, gotoLive, login, revoke, updateDataset, uid } from './api'
import { authFile } from './users'

test('a new dataset appears on another user\'s home page', async ({ browser, request }) => {
  const admin = await browser.newContext({ storageState: authFile('admin') })
  const page = await admin.newPage()
  await gotoLive(page, '/home')

  const name = `Live create ${uid()}`
  await createDataset(request, await login(request, 'lab'), { name })
  await expect(page.getByText(name)).toBeVisible()
  await admin.close()
})

test('a renamed dataset updates on an open dataset page', async ({ browser, request }) => {
  const lab = await login(request, 'lab')
  const dataset = await createDataset(request, lab)
  const admin = await browser.newContext({ storageState: authFile('admin') })
  const page = await admin.newPage()
  await gotoLive(page, `/dataset/${dataset.url}`)
  await expect(page.getByRole('heading', { name: dataset.name })).toBeVisible()

  const renamed = `Renamed ${uid()}`
  await updateDataset(request, lab, dataset.id, { name: renamed })
  await expect(page.getByRole('heading', { name: renamed })).toBeVisible()
  await admin.close()
})

test('a deleted dataset is reported on an open dataset page', async ({ browser, request }) => {
  const lab = await login(request, 'lab')
  const dataset = await createDataset(request, lab)
  const admin = await browser.newContext({ storageState: authFile('admin') })
  const page = await admin.newPage()
  await gotoLive(page, `/dataset/${dataset.url}`)
  await expect(page.getByRole('heading', { name: dataset.name })).toBeVisible()

  await deleteDataset(request, lab, dataset.id)
  await expect(page.getByText('This dataset was deleted or is no longer available to you.')).toBeVisible()
  await admin.close()
})

test('making a dataset public and private again shows and hides it live for an external user', async ({ browser, request }) => {
  const lab = await login(request, 'lab')
  const dataset = await createDataset(request, lab)
  const external = await browser.newContext({ storageState: authFile('external') })
  const page = await external.newPage()
  await gotoLive(page, '/home')
  // Private datasets are not listed for users without access (give the list a moment to load before asserting an absence)
  await expect(page.getByText('BRADY LAB DATASETS')).toBeVisible()
  await expect(page.getByText(dataset.name)).toHaveCount(0)

  await updateDataset(request, lab, dataset.id, { visibility: DatasetVisibility.PUBLIC })
  await expect(page.getByText(dataset.name)).toBeVisible()

  await updateDataset(request, lab, dataset.id, { visibility: DatasetVisibility.PRIVATE })
  await expect(page.getByText(dataset.name)).toHaveCount(0)
  await external.close()
})

test('granting and revoking DOWNLOAD access shows and hides the Data button live', async ({ browser, request }) => {
  const lab = await login(request, 'lab')
  const externalUser = (await login(request, 'external')).user
  const dataset = await createDataset(request, lab, { visibility: DatasetVisibility.PUBLIC })
  const external = await browser.newContext({ storageState: authFile('external') })
  const page = await external.newPage()
  await gotoLive(page, `/dataset/${dataset.url}`)
  await expect(page.getByRole('heading', { name: dataset.name })).toBeVisible()
  // A public dataset can be viewed, but not downloaded, without a DOWNLOAD permission
  await expect(page.getByRole('button', { name: 'Data' })).toHaveCount(0)

  await grant(request, lab, dataset.id, externalUser.id, PermissionOptions.DOWNLOAD)
  await expect(page.getByRole('button', { name: 'Data' })).toBeVisible()

  await revoke(request, lab, dataset.id, externalUser.id)
  await expect(page.getByRole('button', { name: 'Data' })).toHaveCount(0)
  await external.close()
})

// The home page asks for the dataset list when it opens. A change pushed while that request is in flight is newer than the list that
// answers it, so the list must not undo it (the server answers with its state from before the change)
test('a dataset made public while the page is still loading its list is not lost', async ({ browser, request }) => {
  const lab = await login(request, 'lab')
  const dataset = await createDataset(request, lab)
  const external = await browser.newContext({ storageState: authFile('external') })
  const page = await external.newPage()
  // Hold back the page's first list response, which the server has already answered without the (still private) dataset
  let release: () => Promise<void> = async () => {}
  let first = true
  const held = new Promise<void>((resolve) => {
    void page.route('**/api/datasets', async (route) => {
      if (!first) return route.continue()
      first = false
      const response = await route.fetch()
      release = () => route.fulfill({ response })
      resolve()
    })
  })
  const socket = page.waitForEvent('websocket', (ws) => ws.url().includes('/socket.io'))
  await page.goto('/home')
  await held
  await socket

  await updateDataset(request, lab, dataset.id, { visibility: DatasetVisibility.PUBLIC })
  // The push has arrived before the stale list is let through
  await expect.poll(() => page.evaluate(() => document.body.innerText)).toContain(dataset.name)
  await release()
  await expect(page.getByText('BRADY LAB DATASETS')).toBeVisible()
  await expect(page.getByText(dataset.name)).toBeVisible()
  await external.close()
})
