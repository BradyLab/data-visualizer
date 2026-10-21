// Helpers for the dataset form. A new dataset needs a tissue map unless the plots it offers are picked and leave the tissue plot out,
// so specs that are about something else call pickUmapOnly (or attach a map) before saving
import { type Page } from '@playwright/test'
import { DatasetPlots } from '@commons/dataset'
import { pickOption } from './admin'

/** The CSV of a small valid ggPlantmap table */
export const TISSUE_MAP = Buffer.from(['"ROI.name","ROI.id","point","x","y"', '"Cortex",1,1,0,0', '"Cortex",1,2,1,0', '"Cortex",1,3,1,1'].join('\n'))

/** The "Pick Your Plots" dropdown */
export const plotsField = (page: Page) =>
  page.locator('xpath=//*[normalize-space(text())="Pick Your Plots"]/following::div[contains(@class,"v-select")][1]')

/** Picks a plot in the dropdown and closes it */
export const pickPlot = async (page: Page, plot: DatasetPlots) => {
  await pickOption(page, plotsField(page), plot)
  await page.keyboard.press('Escape')
}

/** Offers only the UMAP, so no tissue map is needed */
export const pickUmapOnly = (page: Page) => pickPlot(page, DatasetPlots.UMAP)

/** Picks a tissue map in the form's upload box */
export const attachTissueMap = (page: Page, buffer: Buffer = TISSUE_MAP) =>
  page.locator('input[type="file"][accept=".csv"]').setInputFiles({ name: 'map.csv', mimeType: 'text/csv', buffer })
