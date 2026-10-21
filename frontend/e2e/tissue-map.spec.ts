// Tissue map uploads (the CSV of a ggPlantmap table): a valid map is stored and replaced by newer versions, a wrong file is refused with the reason,
// access follows the dataset's rules, and the edit form reports a refused map
import { test, expect } from '@playwright/test'
import { DatasetVisibility } from '@commons/dataset'
import { FileTypes } from '@commons/file'
import { createDataset, download, getDatasetByUrl, listFiles, login, readFile, uploadFile, uploadFileOk } from './api'
import { authFile } from './users'

test.use({ storageState: authFile('lab') })

const MAP = (name: string) => Buffer.from(['"ROI.name","ROI.id","point","x","y"', `"${name}",1,1,0.5,1.5`, `"${name}",1,2,1,2`].join('\n'))

test('a valid tissue map is stored and can be downloaded as uploaded', async ({ request }) => {
  const lab = await login(request, 'lab')
  const dataset = await createDataset(request, lab)
  const map = MAP('Epidermis')
  await uploadFileOk(request, lab, dataset.id, FileTypes.TISSUE_PLOT, 'root.csv', map)

  const files = (await listFiles(request, lab, dataset.id)).filter((f) => f.type === FileTypes.TISSUE_PLOT)
  expect(files.map((f) => [f.version, f.isCurrent, f.ogName])).toEqual([[1, true, 'root.csv']])
  expect((await download(request, lab, dataset.id, FileTypes.TISSUE_PLOT)).body).toEqual(map)
})

test('a new tissue map replaces the old one but keeps the history, and does not reprocess the dataset', async ({ request }) => {
  const lab = await login(request, 'lab')
  const dataset = await createDataset(request, lab)
  await uploadFileOk(request, lab, dataset.id, FileTypes.TISSUE_PLOT, 'one.csv', MAP('One'))
  const second = MAP('Two')
  await uploadFileOk(request, lab, dataset.id, FileTypes.TISSUE_PLOT, 'two.csv', second)

  const files = (await listFiles(request, lab, dataset.id)).filter((f) => f.type === FileTypes.TISSUE_PLOT)
  expect(files.map((f) => [f.version, f.isCurrent])).toEqual([
    [1, false],
    [2, true],
  ])
  expect((await download(request, lab, dataset.id, FileTypes.TISSUE_PLOT)).body).toEqual(second)
  // A tissue map is independent of the preprocessing
  const after = await (await getDatasetByUrl(request, lab, dataset.url)).json()
  expect(after.status).toBe(dataset.status)
})

test('a file that is not a tissue map is refused and nothing is stored', async ({ request }) => {
  const lab = await login(request, 'lab')
  const dataset = await createDataset(request, lab)
  const wrong = [
    ['missing columns', 'name,x,y\nA,1,2\n'],
    ['no rows', 'ROI.name,ROI.id,x,y\n'],
    ['text coordinates', 'ROI.name,ROI.id,x,y\nA,1,left,right\n'],
    ['an empty file', ''],
  ] as const
  for (const [, content] of wrong) {
    expect(await uploadFile(request, lab, dataset.id, FileTypes.TISSUE_PLOT, 'bad.csv', Buffer.from(content))).toBe(400)
  }
  expect(await uploadFile(request, lab, dataset.id, FileTypes.TISSUE_PLOT, 'map.txt', MAP('A'))).toBe(400)
  expect((await listFiles(request, lab, dataset.id)).filter((f) => f.type === FileTypes.TISSUE_PLOT)).toEqual([])
  expect((await readFile(request, lab, dataset.id, FileTypes.TISSUE_PLOT)).status).toBe(404)
})

test('a refused map leaves the current one in place', async ({ request }) => {
  const lab = await login(request, 'lab')
  const dataset = await createDataset(request, lab)
  const good = MAP('Keep')
  await uploadFileOk(request, lab, dataset.id, FileTypes.TISSUE_PLOT, 'good.csv', good)
  expect(await uploadFile(request, lab, dataset.id, FileTypes.TISSUE_PLOT, 'bad.csv', Buffer.from('a,b\n1,2\n'))).toBe(400)
  expect((await download(request, lab, dataset.id, FileTypes.TISSUE_PLOT)).body).toEqual(good)
})

test('the edit form uploads a tissue map, and says why a wrong one was refused', async ({ page, request }) => {
  const lab = await login(request, 'lab')
  const dataset = await createDataset(request, lab)
  const picker = 'input[type="file"][accept=".csv"]'

  await page.goto(`/dataset/${dataset.url}/edit`)
  await expect(page.getByPlaceholder('DATASET NAME')).toHaveValue(dataset.name)
  await page.locator(picker).setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('name,x\nA,1\n') })
  await page.getByRole('button', { name: 'Save Changes' }).click()
  await expect(page.getByText('The dataset was saved, but a file could not be uploaded.')).toBeVisible()
  await expect(page.getByText(/missing these columns: ROI\.name, ROI\.id, y/)).toBeVisible()
  expect((await listFiles(request, lab, dataset.id)).filter((f) => f.type === FileTypes.TISSUE_PLOT)).toEqual([])

  // The refused file stays selected; replace it with a good one and save again
  const good = MAP('Cortex')
  await page.locator(picker).setInputFiles({ name: 'good.csv', mimeType: 'text/csv', buffer: good })
  await page.getByRole('button', { name: 'Save Changes' }).click()
  await expect(page).toHaveURL(new RegExp(`/dataset/${dataset.url}$`))
  expect((await download(request, lab, dataset.id, FileTypes.TISSUE_PLOT)).body).toEqual(good)
})

test('a tissue map follows the dataset rules: only editors upload, and downloading needs DOWNLOAD access', async ({ request }) => {
  const lab = await login(request, 'lab')
  const external = await login(request, 'external')
  const dataset = await createDataset(request, lab, { visibility: DatasetVisibility.PUBLIC })
  await uploadFileOk(request, lab, dataset.id, FileTypes.TISSUE_PLOT, 'root.csv', MAP('A'))
  // The external user can see the public dataset but may neither upload to it nor read its map
  expect(await uploadFile(request, external, dataset.id, FileTypes.TISSUE_PLOT, 'x.csv', MAP('B'))).toBe(403)
  expect((await download(request, external, dataset.id, FileTypes.TISSUE_PLOT)).status).toBe(403)
  expect((await download(request, null, dataset.id, FileTypes.TISSUE_PLOT)).status).toBe(401)
})
