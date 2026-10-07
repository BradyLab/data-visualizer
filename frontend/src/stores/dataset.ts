// Pinia store holding the list of datasets and wrapping the dataset API calls
import { ref } from "vue";
import { defineStore } from "pinia";
import type { IDataset } from "@commons/dataset";
import { datasetApi } from "@src/api/dataset";
import { usePermissionStore } from "@src/stores/permission";
import { type CreateDatasetPayload, type UpdateDatasetPayload } from "@src/interfaces/dataset";

export const useDatasetStore = defineStore("dataset", () => {
    const datasets = ref<IDataset[]>([]);
    // Result of the latest getById / getByUrl lookup (null if that lookup found nothing)
    const currentDataset = ref<IDataset | null>(null);
    // Counts lookups so a slow earlier one can't overwrite currentDataset after a newer lookup has started
    let latestLookup = 0;

    // True while the latest fetchDatasets failed, so the layout can tell the viewer the dataset list may be missing or stale
    const loadFailed = ref(false);

    /** Loads all datasets from the backend into the store; records a failure in loadFailed and still rejects so callers can react */
    async function fetchDatasets() {
        try {
            datasets.value = await datasetApi.getDatasets();
            loadFailed.value = false;
        } catch (error) {
            loadFailed.value = true;
            throw error;
        }
    }

    /** Fetches the dataset with this id from the backend, or null if there is none; also stores it in currentDataset unless a newer lookup has started */
    async function getById(id: string) {
        const lookup = ++latestLookup;
        const dataset = await datasetApi.getDataset(id);
        if (lookup === latestLookup) currentDataset.value = dataset;
        return dataset;
    }

    /** Fetches the dataset with this url slug from the backend, or null if there is none; also stores it in currentDataset unless a newer lookup has started */
    async function getByUrl(url: string) {
        const lookup = ++latestLookup;
        const dataset = await datasetApi.getDatasetByUrl(url);
        if (lookup === latestLookup) currentDataset.value = dataset;
        return dataset;
    }

    /** Creates a dataset and adds it to the store */
    async function addDataset(payload: CreateDatasetPayload) {
        const dataset = await datasetApi.createDataset(payload);
        datasets.value.push(dataset);
        return dataset;
    }

    /** Updates a dataset and replaces it in the store (including currentDataset if it is the open one) */
    async function editDataset(id: string, payload: UpdateDatasetPayload) {
        const dataset = await datasetApi.updateDataset(id, payload);
        const i = datasets.value.findIndex((d) => d.id === id);
        // Replace in place if cached, otherwise add it
        if (i === -1) datasets.value.push(dataset);
        else datasets.value[i] = dataset;
        // Keep the open dataset in sync so pages showing it don't display stale data
        if (currentDataset.value?.id === id) currentDataset.value = dataset;
        return dataset;
    }

    /** Deletes a dataset and removes it from the store (clearing currentDataset if it is the open one) */
    async function removeDataset(id: string) {
        await datasetApi.deleteDataset(id);
        // Don't leave the open dataset pointing at one that no longer exists
        if (currentDataset.value?.id === id) currentDataset.value = null;
        // The backend deletes the dataset's permissions with it, so drop the cached rows too
        usePermissionStore().removeForDataset(id);
        datasets.value = datasets.value.filter((d) => d.id !== id);
    }

    return { datasets, currentDataset, loadFailed, fetchDatasets, getById, getByUrl, addDataset, editDataset, removeDataset };
});
